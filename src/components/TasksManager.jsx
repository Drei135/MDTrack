import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  CheckCircle2,
  Circle,
  Trash2,
  Paperclip,
  Share2,
  Pencil,
  X,
  Loader2,
  Filter,
  ArrowUpDown,
  CalendarClock,
  CheckSquare,
  Square
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import {
  listTasks,
  createTask,
  updateTask,
  toggleTaskDone,
  deleteTask,
  listTaskAttachments,
  attachFileToTask,
  removeTaskAttachment,
  sortTasks,
  filterTasks,
  isOverdue
} from '../lib/taskOps';
import { listCommittees, committeeLabels } from '../lib/orgOps';
import { attachSuiteAutoSync, listPendingSuiteCount } from '../lib/offlineDbSuite';

export default function TasksManager({ user }) {
  const [tasks, setTasks] = useState([]);
  const [committees, setCommittees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [sortBy, setSortBy] = useState('target_date');
  const [filterCommittee, setFilterCommittee] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [modal, setModal] = useState(null); // { type: 'create' | 'detail', task? }
  const [pendingCount, setPendingCount] = useState(0);
  const [toast, setToast] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [t, c] = await Promise.all([listTasks(), listCommittees()]);
      setTasks(t);
      setCommittees(c);
    } catch (err) {
      setToast(err.message);
      setTimeout(() => setToast(''), 4000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const detach = attachSuiteAutoSync((result) => {
      if (result.succeeded > 0) {
        setToast(`Synced ${result.succeeded} offline task change${result.succeeded === 1 ? '' : 's'}`);
        setTimeout(() => setToast(''), 3000);
        refresh();
      }
      listPendingSuiteCount().then(setPendingCount);
    });
    listPendingSuiteCount().then(setPendingCount);
    return detach;
  }, [refresh]);

  // Realtime: reflect other members' task changes immediately.
  const channelNameRef = useRef(`tasks-realtime-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    const channel = supabase
      .channel(channelNameRef.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const committeeOptions = useMemo(() => committeeLabels(committees), [committees]);

  const visibleTasks = useMemo(() => {
    const filtered = filterTasks(tasks, { committee: filterCommittee, status: filterStatus, search });
    return sortTasks(filtered, sortBy);
  }, [tasks, filterCommittee, filterStatus, search, sortBy]);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((prev) => (prev.size === visibleTasks.length ? new Set() : new Set(visibleTasks.map((t) => t.id))));
  }

  async function handleToggleDone(task) {
    await toggleTaskDone(task);
    refresh();
  }

  async function handleDelete(id) {
    await deleteTask(id);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    refresh();
  }

  async function handleBulkDelete() {
    for (const id of selected) {
      // eslint-disable-next-line no-await-in-loop
      await deleteTask(id);
    }
    setSelected(new Set());
    refresh();
  }

  async function handleBulkComplete() {
    for (const id of selected) {
      const t = tasks.find((x) => x.id === id);
      if (t && !t.is_done) {
        // eslint-disable-next-line no-await-in-loop
        await updateTask(id, { is_done: true, completed_at: new Date().toISOString() });
      }
    }
    setSelected(new Set());
    refresh();
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 py-3 border-b border-slate-800 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">Tasks</h1>
          <button
            onClick={() => setModal({ type: 'create' })}
            className="flex items-center gap-1.5 bg-accent-500 hover:bg-accent-600 text-sm px-3 py-2 rounded-xl"
          >
            <Plus size={15} /> New task
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks"
            className="flex-1 min-w-[140px] bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent-500"
          />
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg ${
              showFilters ? 'bg-accent-500/20 text-accent-300' : 'bg-slate-800 text-slate-300'
            }`}
          >
            <Filter size={13} /> Filters
          </button>
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-slate-400 hover:bg-slate-800"
          >
            {selected.size === visibleTasks.length && visibleTasks.length > 0 ? (
              <CheckSquare size={14} className="text-accent-400" />
            ) : (
              <Square size={14} />
            )}
            Select all
          </button>
        </div>

        {showFilters && (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="flex items-center gap-1 text-slate-500">
              <ArrowUpDown size={12} /> Sort:
            </span>
            {[
              ['target_date', 'Target date'],
              ['committee', 'Committee'],
              ['completion', 'Completion']
            ].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setSortBy(val)}
                className={`px-2.5 py-1 rounded-full ${sortBy === val ? 'bg-accent-500 text-white' : 'bg-slate-800 text-slate-300'}`}
              >
                {label}
              </button>
            ))}
            <span className="text-slate-700 mx-1">|</span>
            <select
              value={filterCommittee}
              onChange={(e) => setFilterCommittee(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-200"
            >
              <option value="">All committees</option>
              {committeeOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-200"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="done">Done</option>
            </select>
          </div>
        )}

        {selected.size > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">{selected.size} selected</span>
            <button onClick={handleBulkComplete} className="px-2.5 py-1 rounded-lg bg-emerald-950/60 text-emerald-300 border border-emerald-900">
              Mark done
            </button>
            <button onClick={handleBulkDelete} className="px-2.5 py-1 rounded-lg bg-red-950/60 text-red-300 border border-red-900">
              Delete
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="mx-4 mt-2 text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">{toast}</div>
      )}
      {pendingCount > 0 && (
        <div className="mx-4 mt-2 text-xs bg-amber-950/40 border border-amber-900 text-amber-300 rounded-lg px-3 py-1.5">
          {pendingCount} task change{pendingCount === 1 ? '' : 's'} queued for sync
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-2">
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-500">
            <Loader2 className="animate-spin mr-2" size={18} /> Loading tasks…
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
            <CalendarClock size={32} className="opacity-40" />
            <p className="text-sm">No tasks match these filters</p>
          </div>
        ) : (
          visibleTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              selected={selected.has(task.id)}
              onToggleSelect={() => toggleSelect(task.id)}
              onToggleDone={() => handleToggleDone(task)}
              onOpen={() => setModal({ type: 'detail', task })}
              onDelete={() => handleDelete(task.id)}
            />
          ))
        )}
      </div>

      {modal?.type === 'create' && (
        <TaskFormModal
          user={user}
          committeeOptions={committeeOptions}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            refresh();
          }}
        />
      )}

      {modal?.type === 'detail' && (
        <TaskDetailModal
          user={user}
          task={modal.task}
          committeeOptions={committeeOptions}
          onClose={() => setModal(null)}
          onChanged={refresh}
          onDelete={() => {
            handleDelete(modal.task.id);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function TaskRow({ task, selected, onToggleSelect, onToggleDone, onOpen, onDelete }) {
  const overdue = isOverdue(task);
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        selected ? 'border-accent-500 bg-accent-500/10' : 'border-slate-800 hover:bg-slate-900'
      }`}
    >
      <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1 accent-accent-500" />
      <button onClick={onToggleDone} className="mt-0.5 shrink-0">
        {task.is_done ? (
          <CheckCircle2 size={20} className="text-emerald-400" />
        ) : (
          <Circle size={20} className="text-slate-500" />
        )}
      </button>
      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <p className={`text-sm ${task.is_done ? 'line-through text-slate-500' : 'text-slate-100'}`}>{task.title}</p>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {task.target_date && (
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${overdue ? 'bg-red-950/60 text-red-300' : 'bg-slate-800 text-slate-400'}`}>
              {new Date(task.target_date).toLocaleDateString()}
            </span>
          )}
          {(task.committees || []).map((c) => (
            <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-accent-500/15 text-accent-300">
              {c}
            </span>
          ))}
        </div>
      </button>
      <button onClick={onDelete} className="p-1.5 rounded-md hover:bg-red-950/50 text-slate-500 hover:text-red-300 shrink-0">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
function CommitteeCheckboxes({ options, selected, onChange }) {
  function toggle(label) {
    if (selected.includes(label)) onChange(selected.filter((s) => s !== label));
    else onChange([...selected, label]);
  }
  return (
    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border border-slate-800 rounded-lg">
      {options.length === 0 && <p className="text-xs text-slate-500">No committees defined yet — add some in the Org Chart tab.</p>}
      {options.map((label) => (
        <label
          key={label}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg cursor-pointer ${
            selected.includes(label) ? 'bg-accent-500/20 text-accent-300' : 'bg-slate-800 text-slate-300'
          }`}
        >
          <input
            type="checkbox"
            checked={selected.includes(label)}
            onChange={() => toggle(label)}
            className="accent-accent-500"
          />
          {label}
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
function TaskFormModal({ user, committeeOptions, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [committees, setCommittees] = useState([]);
  const [targetDate, setTargetDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError('');
    try {
      await createTask(user.id, { title: title.trim(), description, committees, target_date: targetDate || null });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center animate-fade-in">
      <form
        onSubmit={submit}
        className="w-full md:max-w-lg bg-slate-900 border border-slate-800 md:rounded-2xl rounded-t-2xl p-5 space-y-4 animate-scale-in max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">New task</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-slate-800 text-slate-400">
            <X size={16} />
          </button>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent-500"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          rows={3}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent-500 resize-none"
        />
        <label className="block text-xs text-slate-400">
          Target completion date
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
          />
        </label>
        <div>
          <p className="text-xs text-slate-400 mb-1.5">Assigned committees</p>
          <CommitteeCheckboxes options={committeeOptions} selected={committees} onChange={setCommittees} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg hover:bg-slate-800">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-2 text-sm rounded-lg bg-accent-500 hover:bg-accent-600 disabled:opacity-60 flex items-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />} Create task
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
function TaskDetailModal({ user, task, committeeOptions, onClose, onChanged, onDelete }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [committees, setCommittees] = useState(task.committees || []);
  const [targetDate, setTargetDate] = useState(task.target_date || '');
  const [attachments, setAttachments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shareLink, setShareLink] = useState('');

  useEffect(() => {
    listTaskAttachments(task.id).then(setAttachments).catch(() => {});
  }, [task.id]);

  async function persist(patch) {
    setBusy(true);
    setError('');
    try {
      await updateTask(task.id, patch);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAttach(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const att = await attachFileToTask(user.id, task, file);
      setAttachments((prev) => [...prev, att]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveAttachment(id) {
    await removeTaskAttachment(id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleShare() {
    try {
      const url = `${window.location.origin}/tasks/${task.id}`;
      setShareLink(url);
      await navigator.clipboard.writeText(url);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center animate-fade-in">
      <div className="w-full md:max-w-lg bg-slate-900 border border-slate-800 md:rounded-2xl rounded-t-2xl p-5 space-y-4 animate-scale-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          {editingTitle ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setEditingTitle(false);
                if (title.trim() && title !== task.title) persist({ title: title.trim() });
              }}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-sm mr-2"
            />
          ) : (
            <button onClick={() => setEditingTitle(true)} className="flex items-center gap-2 text-sm font-medium text-left">
              {task.title}
              <Pencil size={12} className="text-slate-500" />
            </button>
          )}
          <button onClick={onClose} className="p-1 rounded-md hover:bg-slate-800 text-slate-400">
            <X size={16} />
          </button>
        </div>

        {error && <p className="text-sm text-red-300">{error}</p>}

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== (task.description || '') && persist({ description })}
          rows={3}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm resize-none"
          placeholder="Description"
        />

        <label className="block text-xs text-slate-400">
          Target completion date
          <input
            type="date"
            value={targetDate}
            onChange={(e) => {
              setTargetDate(e.target.value);
              persist({ target_date: e.target.value || null });
            }}
            className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
          />
        </label>

        <div>
          <p className="text-xs text-slate-400 mb-1.5">Assigned committees</p>
          <CommitteeCheckboxes
            options={committeeOptions}
            selected={committees}
            onChange={(next) => {
              setCommittees(next);
              persist({ committees: next });
            }}
          />
        </div>

        <div>
          <p className="text-xs text-slate-400 mb-1.5 flex items-center gap-1.5">
            <Paperclip size={12} /> Attachments
          </p>
          <div className="space-y-1.5">
            {attachments.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-xs bg-slate-800 rounded-lg px-2.5 py-1.5">
                <span className="truncate">{a.file_name}</span>
                <button onClick={() => handleRemoveAttachment(a.id)} className="text-red-300 hover:text-red-200">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <label className="mt-2 flex items-center justify-center gap-1.5 text-xs px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer">
            <Paperclip size={13} /> Attach file or photo
            <input type="file" accept="image/*,application/*" className="hidden" onChange={handleAttach} />
          </label>
        </div>

        {shareLink && (
          <p className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900 rounded-lg px-3 py-2">
            Link copied: {shareLink}
          </p>
        )}

        <div className="flex justify-between items-center pt-1">
          <button onClick={onDelete} className="flex items-center gap-1.5 text-sm text-red-300 hover:text-red-200">
            <Trash2 size={14} /> Delete
          </button>
          <div className="flex gap-2">
            <button onClick={handleShare} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700">
              <Share2 size={14} /> Share
            </button>
            <button
              onClick={() => persist({ is_done: !task.is_done })}
              disabled={busy}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-600"
            >
              {task.is_done ? 'Mark not done' : 'Mark done'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
