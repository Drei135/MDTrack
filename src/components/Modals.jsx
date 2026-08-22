import React, { useEffect, useState } from 'react';
import { X, Loader2, Copy as CopyIcon, Check, FolderTree, Folder } from 'lucide-react';
import { formatBytes } from '../lib/fileOps';

function ModalShell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center px-4 animate-fade-in">
      <div className={`w-full ${wide ? 'max-w-lg' : 'max-w-sm'} bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl animate-scale-in`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-medium text-slate-100">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-slate-800 text-slate-400">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function NewFolderModal({ onCreate, onClose }) {
  const [name, setName] = useState('Untitled folder');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onCreate(name.trim() || 'Untitled folder');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="New folder" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-sm text-red-300">{error}</p>}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent-500"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg hover:bg-slate-800">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-lg bg-accent-500 hover:bg-accent-600 disabled:opacity-60 flex items-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />} Create
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
export function RenameModal({ item, onRename, onClose }) {
  const [name, setName] = useState(item.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onRename(name.trim());
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`Rename "${item.name}"`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-sm text-red-300">{error}</p>}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent-500"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg hover:bg-slate-800">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-lg bg-accent-500 hover:bg-accent-600 disabled:opacity-60 flex items-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />} Save
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
/**
 * Folder-picker used for both Move and Copy. `listFolder` is passed in so the
 * picker can reuse FileManager's data-loading (and thus offline cache) logic.
 */
export function FolderPickerModal({ mode, item, rootLabel, listFolder, onConfirm, onClose }) {
  const [stack, setStack] = useState([{ id: null, name: rootLabel }]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const current = stack[stack.length - 1];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listFolder(current.id)
      .then((rows) => !cancelled && setFolders(rows.filter((r) => r.is_folder && r.id !== item?.id)))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [current.id]);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm(current.id);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`${mode === 'move' ? 'Move' : 'Copy'} "${item?.name}"`} onClose={onClose} wide>
      <div className="space-y-4">
        {error && <p className="text-sm text-red-300">{error}</p>}

        {/* breadcrumb */}
        <div className="flex items-center gap-1 text-xs text-slate-400 flex-wrap">
          {stack.map((s, i) => (
            <React.Fragment key={s.id ?? 'root'}>
              {i > 0 && <span className="text-slate-600">/</span>}
              <button
                onClick={() => setStack(stack.slice(0, i + 1))}
                className={`hover:text-slate-100 ${i === stack.length - 1 ? 'text-slate-100 font-medium' : ''}`}
              >
                {s.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="h-56 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800">
          {loading ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              <Loader2 className="animate-spin mr-2" size={16} /> Loading…
            </div>
          ) : folders.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">No subfolders here</div>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                onClick={() => setStack([...stack, { id: f.id, name: f.name }])}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-800"
              >
                <Folder size={15} className="text-accent-400" />
                {f.name}
              </button>
            ))
          )}
        </div>

        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <FolderTree size={13} /> Destination: {current.name}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg hover:bg-slate-800">
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded-lg bg-accent-500 hover:bg-accent-600 disabled:opacity-60 flex items-center gap-2"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {mode === 'move' ? 'Move here' : 'Copy here'}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
export function ShareModal({ item, onCreateLink, onRevoke, onClose }) {
  const [permission, setPermission] = useState(item.share_permission || 'view');
  const [expires, setExpires] = useState('never');
  const [link, setLink] = useState(item.share_token ? `${window.location.origin}/share/${item.share_token}` : '');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const hours = expires === 'never' ? null : Number(expires);
      const { url } = await onCreateLink({ permission, expiresInHours: hours });
      setLink(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await onRevoke();
      setLink('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <ModalShell title={`Share "${item.name}"`} onClose={onClose} wide>
      <div className="space-y-4">
        {error && <p className="text-sm text-red-300">{error}</p>}

        <div className="flex gap-3">
          <label className="flex-1 text-xs text-slate-400">
            Permission
            <select
              value={permission}
              onChange={(e) => setPermission(e.target.value)}
              className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100"
            >
              <option value="view">Can view</option>
              <option value="edit">Can edit</option>
            </select>
          </label>
          <label className="flex-1 text-xs text-slate-400">
            Expires
            <select
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100"
            >
              <option value="never">Never</option>
              <option value="24">24 hours</option>
              <option value="168">7 days</option>
              <option value="720">30 days</option>
            </select>
          </label>
        </div>

        {link ? (
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={link}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300"
            />
            <button
              onClick={copyLink}
              className="px-3 py-2 rounded-lg bg-accent-500 hover:bg-accent-600 text-sm flex items-center gap-1.5"
            >
              {copied ? <Check size={14} /> : <CopyIcon size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">No active link for this item yet.</p>
        )}

        <div className="flex justify-end gap-2">
          {link && (
            <button onClick={revoke} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg text-red-300 hover:bg-red-950/50">
              Revoke link
            </button>
          )}
          <button
            onClick={generate}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {link ? 'Regenerate link' : 'Generate link'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
export function DetailsModal({ item, onClose }) {
  const rows = [
    ['Type', item.is_folder ? 'Folder' : item.mime_type || 'Unknown'],
    ['Size', formatBytes(item.size)],
    ['Owner', 'You'],
    ['Created', new Date(item.created_at).toLocaleString()],
    ['Modified', new Date(item.updated_at).toLocaleString()],
    ['Starred', item.is_starred ? 'Yes' : 'No'],
    ['Shared', item.share_token ? 'Yes (link active)' : 'No']
  ];
  return (
    <ModalShell title="Details" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm font-medium text-slate-100 break-all">{item.name}</p>
        <dl className="divide-y divide-slate-800 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between py-2">
              <dt className="text-slate-500">{label}</dt>
              <dd className="text-slate-200 text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </ModalShell>
  );
}
