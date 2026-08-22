import { supabase, isOnline } from './supabaseClient';
import { cacheRows, getCachedRows, upsertCachedRow, removeCachedRow, queueSuiteAction } from './offlineDbSuite';
import { uploadFile } from './fileOps';

const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export async function listTasks() {
  if (isOnline()) {
    const { data, error } = await supabase.from('tasks').select('*').order('target_date', { ascending: true });
    if (error) throw error;
    await cacheRows('tasks', data);
    return data;
  }
  return getCachedRows('tasks');
}

export async function listTaskAttachments(taskId) {
  if (!isOnline()) return [];
  const { data, error } = await supabase.from('task_attachments').select('*').eq('task_id', taskId);
  if (error) throw error;
  return data;
}

export async function createTask(ownerId, fields) {
  const id = uuid();
  const row = {
    id,
    owner_id: ownerId,
    title: fields.title,
    description: fields.description ?? '',
    committees: fields.committees ?? [],
    target_date: fields.target_date ?? null,
    is_done: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  await upsertCachedRow('tasks', row);

  if (isOnline()) {
    const { data, error } = await supabase.from('tasks').insert(row).select().single();
    if (error) throw error;
    await upsertCachedRow('tasks', data);
    return data;
  }
  await queueSuiteAction('task', 'create', row);
  return row;
}

export async function updateTask(id, patch) {
  const merged = { ...patch, updated_at: new Date().toISOString() };
  await upsertCachedRow('tasks', { id, ...merged });

  if (isOnline()) {
    const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select().single();
    if (error) throw error;
    await upsertCachedRow('tasks', data);
    return data;
  }
  await queueSuiteAction('task', 'update', { id, ...patch });
  return { id, ...merged };
}

export async function toggleTaskDone(task) {
  const nextDone = !task.is_done;
  return updateTask(task.id, { is_done: nextDone, completed_at: nextDone ? new Date().toISOString() : null });
}

export async function deleteTask(id) {
  await removeCachedRow('tasks', id);
  if (isOnline()) {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) throw error;
  } else {
    await queueSuiteAction('task', 'delete', { id });
  }
}

/**
 * Uploads a file/photo into the shared File Manager storage (reusing the
 * existing fileOps.uploadFile, unmodified) and links it to a task via
 * task_attachments.
 */
export async function attachFileToTask(ownerId, task, file) {
  if (!isOnline()) throw new Error('Attaching files requires an internet connection.');
  const fileRow = await uploadFile(ownerId, null, file);
  const { data, error } = await supabase
    .from('task_attachments')
    .insert({
      task_id: task.id,
      file_id: fileRow.id,
      file_name: fileRow.name,
      storage_path: fileRow.storage_path,
      mime_type: fileRow.mime_type,
      size: fileRow.size,
      uploaded_by: ownerId
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeTaskAttachment(attachmentId) {
  const { error } = await supabase.from('task_attachments').delete().eq('id', attachmentId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Sorting / filtering helpers (pure functions, used by TasksManager.jsx)
// ---------------------------------------------------------------------------
export function sortTasks(tasks, sortBy) {
  const copy = [...tasks];
  switch (sortBy) {
    case 'target_date':
      return copy.sort((a, b) => (a.target_date ?? '9999').localeCompare(b.target_date ?? '9999'));
    case 'committee':
      return copy.sort((a, b) => (a.committees?.[0] ?? '').localeCompare(b.committees?.[0] ?? ''));
    case 'completion':
      return copy.sort((a, b) => Number(a.is_done) - Number(b.is_done));
    default:
      return copy;
  }
}

export function filterTasks(tasks, { committee, status, search }) {
  return tasks.filter((t) => {
    if (committee && !(t.committees || []).includes(committee)) return false;
    if (status === 'done' && !t.is_done) return false;
    if (status === 'pending' && t.is_done) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
}

export function isOverdue(task) {
  if (task.is_done || !task.target_date) return false;
  return new Date(task.target_date) < new Date(new Date().toDateString());
}
