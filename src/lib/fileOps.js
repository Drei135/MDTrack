import { supabase, STORAGE_BUCKET, buildStoragePath, isOnline } from './supabaseClient';
import { cacheItems, upsertCachedItem, removeCachedItem, queueAction, getCachedChildren } from './offlineDb';

const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// ---------------------------------------------------------------------------
// Duplicate-name handling
// ---------------------------------------------------------------------------
// The DB enforces one name per (owner, parent folder) via
// idx_files_folders_sibling_name. Rather than surface that as a raw
// "duplicate key value violates unique constraint" error, every create/
// rename/move/copy below picks an available name up front ("Report.docx" ->
// "Report (2).docx") and also retries once if a race still hits the
// constraint (e.g. two uploads landing at the same instant).

function isUniqueNameViolation(error) {
  return error?.code === '23505' || (error?.message || '').includes('idx_files_folders_sibling_name');
}

async function fetchSiblingNames(ownerId, parentId, excludeId) {
  let query = supabase.from('files_folders').select('id, name').eq('owner_id', ownerId).eq('is_trashed', false);
  query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);
  const { data, error } = await query;
  if (error) throw error;
  return new Set((data || []).filter((r) => r.id !== excludeId).map((r) => r.name.toLowerCase()));
}

/** "Report.docx" -> "Report (2).docx" -> "Report (3).docx" ... until free. */
function nextAvailableName(desiredName, existingNamesLower) {
  if (!existingNamesLower.has(desiredName.toLowerCase())) return desiredName;
  const dot = desiredName.lastIndexOf('.');
  const hasExt = dot > 0 && dot < desiredName.length - 1;
  const base = hasExt ? desiredName.slice(0, dot) : desiredName;
  const ext = hasExt ? desiredName.slice(dot) : '';
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (existingNamesLower.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  return candidate;
}

/**
 * Returns `desiredName` unchanged if it's free in that folder, otherwise the
 * next "(2)", "(3)", ... variant that is. Pass `excludeId` when checking a
 * name for an item that already exists (rename/move) so it doesn't collide
 * with itself.
 */
export async function getAvailableName(ownerId, parentId, desiredName, excludeId) {
  if (!isOnline()) return desiredName; // best-effort offline; server still guards on reconnect
  const existing = await fetchSiblingNames(ownerId, parentId, excludeId);
  return nextAvailableName(desiredName, existing);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listFolder(ownerId, parentId, { trashed = false } = {}) {
  if (isOnline()) {
    let query = supabase
      .from('files_folders')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('is_trashed', trashed)
      .order('is_folder', { ascending: false })
      .order('name', { ascending: true });

    query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);
    const { data, error } = await query;
    if (error) throw error;
    if (!trashed) await cacheItems(data);
    return data;
  }
  return getCachedChildren(ownerId, parentId, { trashed });
}

export async function searchItems(ownerId, term) {
  if (!isOnline()) {
    const all = await getCachedChildren(ownerId, undefined, { trashed: false });
    return all.filter((i) => i.name.toLowerCase().includes(term.toLowerCase()));
  }
  const { data, error } = await supabase
    .from('files_folders')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('is_trashed', false)
    .ilike('name', `%${term}%`)
    .limit(50);
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Create folder
// ---------------------------------------------------------------------------

export async function createFolder(ownerId, parentId, name) {
  const id = uuid();
  const finalName = await getAvailableName(ownerId, parentId, name);
  const optimisticRow = {
    id,
    owner_id: ownerId,
    parent_id: parentId ?? null,
    name: finalName,
    is_folder: true,
    size: 0,
    is_trashed: false,
    is_starred: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  await upsertCachedItem(optimisticRow);

  if (isOnline()) {
    let attemptName = finalName;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await supabase
        .from('files_folders')
        .insert({ id, owner_id: ownerId, parent_id: parentId ?? null, name: attemptName, is_folder: true, size: 0 })
        .select()
        .single();
      if (!error) {
        await upsertCachedItem(data);
        return data;
      }
      if (isUniqueNameViolation(error)) {
        attemptName = await getAvailableName(ownerId, parentId, name);
        continue;
      }
      await removeCachedItem(id);
      throw error;
    }
    await removeCachedItem(id);
    throw new Error(`Couldn't find an available name for "${name}". Try renaming it and creating the folder again.`);
  }

  await queueAction('create_folder', { id, owner_id: ownerId, parent_id: parentId ?? null, name: finalName });
  return optimisticRow;
}

// ---------------------------------------------------------------------------
// Upload (single file, multiple files, or a full folder-tree via
// webkitdirectory / drag-and-drop DataTransferItemList)
// ---------------------------------------------------------------------------

/**
 * Uploads a single browser File object under `parentId`, creating the
 * storage object then the metadata row. Reports progress via onProgress(pct).
 */
export async function uploadFile(ownerId, parentId, file, { onProgress } = {}) {
  const id = uuid();
  const finalName = await getAvailableName(ownerId, parentId, file.name);
  const storagePath = buildStoragePath(ownerId, id, finalName);

  if (!isOnline()) {
    throw new Error('Uploads require an internet connection. The file was not queued.');
  }

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (uploadError) throw uploadError;
  onProgress?.(70);

  let attemptName = finalName;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from('files_folders')
      .insert({
        id,
        owner_id: ownerId,
        parent_id: parentId ?? null,
        name: attemptName,
        is_folder: false,
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
        storage_path: storagePath
      })
      .select()
      .single();

    if (!error) {
      onProgress?.(100);
      await upsertCachedItem(data);
      return data;
    }
    if (isUniqueNameViolation(error)) {
      attemptName = await getAvailableName(ownerId, parentId, file.name);
      continue;
    }
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    throw error;
  }
  await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
  throw new Error(`Couldn't find an available name for "${file.name}". Try uploading it again.`);
}

/**
 * Walks a FileSystemEntry tree (from drag-and-drop or an <input webkitdirectory>
 * FileList's webkitRelativePath) and recreates the folder hierarchy, uploading
 * every file to its corresponding new folder id.
 *
 * `entries`: array of { path: string[], file: File } — path is the list of
 * folder names from the upload root down to (but excluding) the file itself.
 */
export async function uploadFileTree(ownerId, parentId, entries, { onFileComplete, onFileError } = {}) {
  const folderIdCache = new Map(); // key: joined path -> folder id
  folderIdCache.set('', parentId ?? null);

  async function ensureFolder(pathParts) {
    const key = pathParts.join('/');
    if (folderIdCache.has(key)) return folderIdCache.get(key);
    const parentKey = pathParts.slice(0, -1).join('/');
    const parent = folderIdCache.has(parentKey)
      ? folderIdCache.get(parentKey)
      : await ensureFolder(pathParts.slice(0, -1));
    const folder = await createFolder(ownerId, parent, pathParts[pathParts.length - 1]);
    folderIdCache.set(key, folder.id);
    return folder.id;
  }

  const results = [];
  for (const entry of entries) {
    try {
      const targetParent = entry.path.length ? await ensureFolder(entry.path) : (parentId ?? null);
      const row = await uploadFile(ownerId, targetParent, entry.file);
      results.push(row);
      onFileComplete?.(entry, row);
    } catch (err) {
      onFileError?.(entry, err);
    }
  }
  return results;
}

/** Reads a drag-and-drop DataTransferItemList into a flat entries[] list. */
export async function flattenDataTransferItems(items) {
  const entries = [];

  async function readEntry(entry, pathParts) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      entries.push({ path: pathParts, file });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const children = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const child of children) {
        await readEntry(child, [...pathParts, entry.name]);
      }
    }
  }

  const topEntries = Array.from(items)
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean);

  for (const entry of topEntries) {
    await readEntry(entry, []);
  }
  return entries;
}

/** Converts a FileList from <input webkitdirectory multiple> into entries[]. */
export function flattenFileList(fileList) {
  return Array.from(fileList).map((file) => {
    const rel = file.webkitRelativePath || file.name;
    const parts = rel.split('/');
    parts.pop(); // remove filename
    return { path: parts, file };
  });
}

// ---------------------------------------------------------------------------
// Rename / Move / Copy / Star
// ---------------------------------------------------------------------------

export async function renameItem(item, newName) {
  const finalName = await getAvailableName(item.owner_id, item.parent_id, newName, item.id);
  await upsertCachedItem({ ...item, name: finalName });
  if (isOnline()) {
    let attemptName = finalName;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await supabase
        .from('files_folders')
        .update({ name: attemptName })
        .eq('id', item.id)
        .select()
        .single();
      if (!error) {
        await upsertCachedItem(data);
        return data;
      }
      if (isUniqueNameViolation(error)) {
        attemptName = await getAvailableName(item.owner_id, item.parent_id, newName, item.id);
        continue;
      }
      throw error;
    }
    throw new Error(`Couldn't find an available name for "${newName}". Try a different name.`);
  }
  await queueAction('rename', { id: item.id, name: finalName });
  return { ...item, name: finalName };
}

export async function moveItem(item, newParentId) {
  const finalName = await getAvailableName(item.owner_id, newParentId, item.name, item.id);
  await upsertCachedItem({ ...item, parent_id: newParentId, name: finalName });
  if (isOnline()) {
    let attemptName = finalName;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await supabase
        .from('files_folders')
        .update({ parent_id: newParentId, name: attemptName })
        .eq('id', item.id)
        .select()
        .single();
      if (!error) {
        await upsertCachedItem(data);
        return data;
      }
      if (isUniqueNameViolation(error)) {
        attemptName = await getAvailableName(item.owner_id, newParentId, item.name, item.id);
        continue;
      }
      throw error;
    }
    throw new Error(`"${item.name}" couldn't be moved — a name conflict kept coming up in the destination folder.`);
  }
  await queueAction('move', { id: item.id, new_parent_id: newParentId, name: finalName });
  return { ...item, parent_id: newParentId, name: finalName };
}

/**
 * Copies a file (storage object duplicated) or recursively copies a folder
 * and all descendants. Requires connectivity (storage copy is not queueable).
 */
export async function copyItem(ownerId, item, newParentId, newName) {
  if (!isOnline()) throw new Error('Copying requires an internet connection.');
  const desiredName = newName ?? item.name;
  const finalName = await getAvailableName(ownerId, newParentId, desiredName);

  if (!item.is_folder) {
    const id = uuid();
    const newPath = buildStoragePath(ownerId, id, finalName);
    const { error: copyErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .copy(item.storage_path, newPath);
    if (copyErr) throw copyErr;

    let attemptName = finalName;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await supabase
        .from('files_folders')
        .insert({
          id,
          owner_id: ownerId,
          parent_id: newParentId ?? null,
          name: attemptName,
          is_folder: false,
          mime_type: item.mime_type,
          size: item.size,
          storage_path: newPath
        })
        .select()
        .single();
      if (!error) {
        await upsertCachedItem(data);
        return data;
      }
      if (isUniqueNameViolation(error)) {
        attemptName = await getAvailableName(ownerId, newParentId, desiredName);
        continue;
      }
      await supabase.storage.from(STORAGE_BUCKET).remove([newPath]);
      throw error;
    }
    await supabase.storage.from(STORAGE_BUCKET).remove([newPath]);
    throw new Error(`Couldn't find an available name for "${desiredName}". Try copying it again.`);
  }

  // Folder: create the new folder, then recurse into children.
  const newFolder = await createFolder(ownerId, newParentId, finalName);
  const { data: children, error } = await supabase
    .from('files_folders')
    .select('*')
    .eq('parent_id', item.id)
    .eq('is_trashed', false);
  if (error) throw error;
  for (const child of children) {
    await copyItem(ownerId, child, newFolder.id, child.name);
  }
  return newFolder;
}

export async function toggleStar(item) {
  const next = !item.is_starred;
  await upsertCachedItem({ ...item, is_starred: next });
  if (isOnline()) {
    const { error } = await supabase.from('files_folders').update({ is_starred: next }).eq('id', item.id);
    if (error) throw error;
  } else {
    await queueAction('toggle_star', { id: item.id, is_starred: next });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Trash lifecycle
// ---------------------------------------------------------------------------

export async function trashItem(item) {
  await upsertCachedItem({ ...item, is_trashed: true, trashed_at: new Date().toISOString() });
  if (isOnline()) {
    const { error } = await supabase.rpc('trash_item_cascade', { item_id: item.id });
    if (error) throw error;
  } else {
    await queueAction('trash', { id: item.id });
  }
}

export async function restoreItem(item) {
  await upsertCachedItem({ ...item, is_trashed: false, trashed_at: null });
  if (isOnline()) {
    const { error } = await supabase.rpc('restore_item_cascade', { item_id: item.id });
    if (error) throw error;
  } else {
    await queueAction('restore', { id: item.id });
  }
}

export async function purgeItem(item) {
  if (!isOnline()) {
    await queueAction('purge', { id: item.id });
    await removeCachedItem(item.id);
    return;
  }
  const { data, error } = await supabase.rpc('purge_item_cascade', { item_id: item.id });
  if (error) throw error;
  const paths = (data ?? []).map((r) => r.storage_path).filter(Boolean);
  if (paths.length) await supabase.storage.from(STORAGE_BUCKET).remove(paths);
  await removeCachedItem(item.id);
}

export async function emptyTrash(ownerId) {
  if (!isOnline()) throw new Error('Emptying trash requires an internet connection.');
  const { data, error } = await supabase.rpc('empty_trash');
  if (error) throw error;
  const paths = (data ?? []).map((r) => r.storage_path).filter(Boolean);
  if (paths.length) await supabase.storage.from(STORAGE_BUCKET).remove(paths);
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export async function createShareLink(item, { permission = 'view', expiresInHours = null } = {}) {
  const { data: token, error } = await supabase.rpc('create_share_link', {
    item_id: item.id,
    permission,
    expires_in_hours: expiresInHours
  });
  if (error) throw error;
  const url = `${window.location.origin}/share/${token}`;
  return { token, url };
}

export async function revokeShareLink(item) {
  const { error } = await supabase.rpc('revoke_share_link', { item_id: item.id });
  if (error) throw error;
}

/** Returns a time-limited signed URL for previewing/downloading a private file. */
/**
 * Overwrites the storage object for a text-based file (txt/code/markdown)
 * with new content, then updates its size/updated_at metadata row. Requires
 * connectivity - content edits are not queued offline since they replace
 * binary storage bytes, not just a metadata field.
 */
export async function updateFileContent(item, newContent) {
  if (!isOnline()) {
    throw new Error('Saving requires an internet connection. Your edits are still in the editor — reconnect and save again.');
  }
  const blob = new Blob([newContent], { type: item.mime_type || 'text/plain' });

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(item.storage_path, blob, {
      contentType: item.mime_type || 'text/plain',
      upsert: true
    });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('files_folders')
    .update({ size: blob.size })
    .eq('id', item.id)
    .select()
    .single();
  if (error) throw error;

  await upsertCachedItem(data);
  return data;
}

export async function getSignedUrl(item, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(item.storage_path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function downloadItem(item) {
  const url = await getSignedUrl(item, 300);
  const a = document.createElement('a');
  a.href = url;
  a.download = item.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function extensionOf(name) {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
}
