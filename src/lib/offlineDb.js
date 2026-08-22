import Dexie from 'dexie';
import { supabase } from './supabaseClient';

/**
 * offlineDb.js
 * -------------------------------------------------------------------------
 * Two Dexie tables:
 *   - `items`       mirrors public.files_folders rows the user has fetched,
 *                    so the grid/list can render instantly offline.
 *   - `syncQueue`    queued mutations (rename, create-folder, move, copy,
 *                    trash, restore, purge, share) recorded while offline,
 *                    replayed in order once connectivity returns.
 * -------------------------------------------------------------------------
 */

export const db = new Dexie('filevault-offline');

db.version(1).stores({
  items: 'id, parent_id, owner_id, is_trashed, name, updated_at',
  syncQueue: '++id, created_at, status'
});

// ---------------------------------------------------------------------------
// Metadata cache
// ---------------------------------------------------------------------------

/** Replace the local cache for a set of rows (upsert). */
export async function cacheItems(rows) {
  if (!rows || rows.length === 0) return;
  await db.items.bulkPut(rows);
}

/** Read children of a folder (or root, when parentId is null) from cache. */
export async function getCachedChildren(ownerId, parentId, { trashed = false } = {}) {
  const all = await db.items
    .where('owner_id')
    .equals(ownerId)
    .toArray();
  return all.filter(
    (r) => (r.parent_id ?? null) === (parentId ?? null) && !!r.is_trashed === trashed
  );
}

export async function getCachedItem(id) {
  return db.items.get(id);
}

export async function removeCachedItem(id) {
  await db.items.delete(id);
}

export async function upsertCachedItem(row) {
  await db.items.put(row);
}

// ---------------------------------------------------------------------------
// Sync queue
// ---------------------------------------------------------------------------

/**
 * Queue an offline action. `type` matches a case in `replayAction` below.
 * `payload` carries everything needed to replay it against Supabase.
 */
export async function queueAction(type, payload) {
  const record = {
    type,
    payload,
    status: 'pending',
    created_at: new Date().toISOString(),
    attempts: 0
  };
  const id = await db.syncQueue.add(record);
  return { id, ...record };
}

export async function listPendingActions() {
  return db.syncQueue.where('status').equals('pending').sortBy('created_at');
}

export async function listAllQueueEntries() {
  return db.syncQueue.orderBy('created_at').reverse().toArray();
}

export async function markActionStatus(id, status, error) {
  await db.syncQueue.update(id, { status, error: error ?? null, attempts_incremented_at: new Date().toISOString() });
}

export async function removeAction(id) {
  await db.syncQueue.delete(id);
}

// Mirrors the unique-name handling in fileOps.js (kept local to avoid a
// circular import — fileOps.js already imports from this file). Used only
// when replaying a queued action created while offline.
function isUniqueNameViolation(error) {
  return error?.code === '23505' || (error?.message || '').includes('idx_files_folders_sibling_name');
}

async function nextAvailableNameFor(ownerId, parentId, desiredName, excludeId) {
  let query = supabase.from('files_folders').select('id, name').eq('owner_id', ownerId).eq('is_trashed', false);
  query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);
  const { data, error } = await query;
  if (error) throw error;
  const existing = new Set((data || []).filter((r) => r.id !== excludeId).map((r) => r.name.toLowerCase()));
  if (!existing.has(desiredName.toLowerCase())) return desiredName;
  const dot = desiredName.lastIndexOf('.');
  const hasExt = dot > 0 && dot < desiredName.length - 1;
  const base = hasExt ? desiredName.slice(0, dot) : desiredName;
  const ext = hasExt ? desiredName.slice(dot) : '';
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (existing.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  return candidate;
}

async function replayAction(action) {
  const { type, payload } = action;
  switch (type) {
    case 'create_folder': {
      let name = payload.name;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { error } = await supabase.from('files_folders').insert({
          id: payload.id,
          owner_id: payload.owner_id,
          parent_id: payload.parent_id,
          name,
          is_folder: true,
          size: 0
        });
        if (!error) return;
        if (isUniqueNameViolation(error)) {
          name = await nextAvailableNameFor(payload.owner_id, payload.parent_id, payload.name);
          continue;
        }
        throw error;
      }
      throw new Error(`Couldn't find an available name for "${payload.name}".`);
    }
    case 'rename': {
      let name = payload.name;
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await db.items.get(payload.id);
        const { error } = await supabase.from('files_folders').update({ name }).eq('id', payload.id);
        if (!error) return;
        if (isUniqueNameViolation(error)) {
          name = await nextAvailableNameFor(current?.owner_id, current?.parent_id, payload.name, payload.id);
          continue;
        }
        throw error;
      }
      throw new Error(`Couldn't find an available name for "${payload.name}".`);
    }
    case 'move': {
      let name = payload.name;
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await db.items.get(payload.id);
        const update = { parent_id: payload.new_parent_id };
        if (name) update.name = name;
        const { error } = await supabase.from('files_folders').update(update).eq('id', payload.id);
        if (!error) return;
        if (isUniqueNameViolation(error)) {
          name = await nextAvailableNameFor(
            current?.owner_id,
            payload.new_parent_id,
            name || current?.name || 'item',
            payload.id
          );
          continue;
        }
        throw error;
      }
      throw new Error(`"${payload.name || 'This item'}" couldn't be moved — a name conflict kept coming up.`);
    }
    case 'trash': {
      const { error } = await supabase.rpc('trash_item_cascade', { item_id: payload.id });
      if (error) throw error;
      break;
    }
    case 'restore': {
      const { error } = await supabase.rpc('restore_item_cascade', { item_id: payload.id });
      if (error) throw error;
      break;
    }
    case 'purge': {
      const { error } = await supabase.rpc('purge_item_cascade', { item_id: payload.id });
      if (error) throw error;
      break;
    }
    case 'toggle_star': {
      const { error } = await supabase
        .from('files_folders')
        .update({ is_starred: payload.is_starred })
        .eq('id', payload.id);
      if (error) throw error;
      break;
    }
    default:
      throw new Error(`Unknown queued action type: ${type}`);
  }
}

/**
 * Replays every pending queued action in FIFO order. Stops at (and keeps
 * queued) the first action that fails, so ordering/integrity is preserved -
 * e.g. a rename queued before a move on the same item must not be skipped.
 */
export async function syncPendingActions({ onProgress } = {}) {
  const pending = await listPendingActions();
  let succeeded = 0;
  let failed = 0;

  for (const action of pending) {
    try {
      await replayAction(action);
      await markActionStatus(action.id, 'synced');
      succeeded += 1;
    } catch (err) {
      await markActionStatus(action.id, 'error', err.message);
      failed += 1;
      onProgress?.({ succeeded, failed, stoppedEarly: true });
      break; // preserve ordering - don't replay later actions out of order
    }
    onProgress?.({ succeeded, failed, stoppedEarly: false });
  }

  return { succeeded, failed };
}

/** Wire up automatic sync on regaining connectivity. Call once at app start. */
export function attachAutoSync(onDone) {
  const handler = async () => {
    if (!navigator.onLine) return;
    const result = await syncPendingActions();
    onDone?.(result);
  };
  window.addEventListener('online', handler);
  // Also attempt a sync on load in case we came back online before the app
  // mounted (e.g. reopened the PWA after connectivity was restored).
  if (navigator.onLine) handler();
  return () => window.removeEventListener('online', handler);
}

export async function clearAllOfflineData() {
  await db.items.clear();
  await db.syncQueue.clear();
}
