import Dexie from 'dexie';
import { supabase } from './supabaseClient';

/**
 * offlineDbSuite.js
 * -------------------------------------------------------------------------
 * A SEPARATE Dexie database from the original `offlineDb.js` /
 * "filevault-offline" store, so nothing about the existing File Manager's
 * offline cache/queue is touched. This one backs the new modules: Tasks,
 * Meeting Notes (MOM), and the Committees/Org Chart, plus its own sync queue
 * for offline edits to those record types.
 * -------------------------------------------------------------------------
 */

export const suiteDb = new Dexie('filevault-suite');

suiteDb.version(1).stores({
  tasks: 'id, target_date, is_done, updated_at',
  meetingNotes: 'id, meeting_date, status, updated_at',
  committees: 'id, group_order, position_order',
  notifications: 'id, created_at, is_read',
  suiteSyncQueue: '++id, created_at, status, entity'
});

// ---------------------------------------------------------------------------
// Generic cache helpers
// ---------------------------------------------------------------------------
export async function cacheRows(table, rows) {
  if (!rows || rows.length === 0) return;
  await suiteDb[table].bulkPut(rows);
}
export async function getCachedRows(table) {
  return suiteDb[table].toArray();
}
export async function upsertCachedRow(table, row) {
  await suiteDb[table].put(row);
}
export async function removeCachedRow(table, id) {
  await suiteDb[table].delete(id);
}

// ---------------------------------------------------------------------------
// Sync queue (mirrors the pattern in offlineDb.js, scoped to suite entities)
// ---------------------------------------------------------------------------
export async function queueSuiteAction(entity, type, payload) {
  const record = {
    entity, // 'task' | 'meeting_note' | 'committee'
    type, // 'create' | 'update' | 'delete'
    payload,
    status: 'pending',
    created_at: new Date().toISOString()
  };
  const id = await suiteDb.suiteSyncQueue.add(record);
  return { id, ...record };
}

export async function listPendingSuiteActions() {
  return suiteDb.suiteSyncQueue.where('status').equals('pending').sortBy('created_at');
}

export async function markSuiteActionStatus(id, status, error) {
  await suiteDb.suiteSyncQueue.update(id, { status, error: error ?? null });
}

const TABLE_MAP = { task: 'tasks', meeting_note: 'meeting_notes', committee: 'committees_officers' };

async function replaySuiteAction(action) {
  const table = TABLE_MAP[action.entity];
  if (!table) throw new Error(`Unknown suite entity: ${action.entity}`);

  if (action.type === 'create') {
    const { error } = await supabase.from(table).insert(action.payload);
    if (error) throw error;
  } else if (action.type === 'update') {
    const { id, ...patch } = action.payload;
    const { error } = await supabase.from(table).update(patch).eq('id', id);
    if (error) throw error;
  } else if (action.type === 'delete') {
    const { error } = await supabase.from(table).delete().eq('id', action.payload.id);
    if (error) throw error;
  } else {
    throw new Error(`Unknown suite action type: ${action.type}`);
  }
}

export async function syncPendingSuiteActions() {
  const pending = await listPendingSuiteActions();
  let succeeded = 0;
  let failed = 0;
  for (const action of pending) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await replaySuiteAction(action);
      // eslint-disable-next-line no-await-in-loop
      await markSuiteActionStatus(action.id, 'synced');
      succeeded += 1;
    } catch (err) {
      // eslint-disable-next-line no-await-in-loop
      await markSuiteActionStatus(action.id, 'error', err.message);
      failed += 1;
      break; // preserve ordering, same rationale as the file-manager sync queue
    }
  }
  return { succeeded, failed };
}

export function attachSuiteAutoSync(onDone) {
  const handler = async () => {
    if (!navigator.onLine) return;
    const result = await syncPendingSuiteActions();
    onDone?.(result);
  };
  window.addEventListener('online', handler);
  if (navigator.onLine) handler();
  return () => window.removeEventListener('online', handler);
}

export async function listPendingSuiteCount() {
  return (await listPendingSuiteActions()).length;
}
