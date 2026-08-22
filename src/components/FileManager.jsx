import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Folder,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  FileArchive,
  File as FileIcon,
  Star,
  MoreVertical,
  UploadCloud,
  Loader2
} from 'lucide-react';

import Sidebar from './Sidebar';
import Toolbar from './Toolbar';
import ContextMenu from './ContextMenu';
import FileViewerModal from './FileViewerModal';
import { NewFolderModal, RenameModal, FolderPickerModal, ShareModal, DetailsModal } from './Modals';

import { supabase } from '../lib/supabaseClient';
import { attachAutoSync, listPendingActions } from '../lib/offlineDb';
import {
  listFolder,
  searchItems,
  createFolder,
  uploadFile,
  uploadFileTree,
  flattenDataTransferItems,
  flattenFileList,
  renameItem,
  moveItem,
  copyItem,
  toggleStar,
  trashItem,
  restoreItem,
  purgeItem,
  emptyTrash,
  createShareLink,
  revokeShareLink,
  downloadItem,
  formatBytes,
  extensionOf
} from '../lib/fileOps';

const ICONS = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  code: FileCode,
  archive: FileArchive,
  text: FileText
};

function iconFor(item) {
  if (item.is_folder) return Folder;
  const ext = extensionOf(item.name);
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return ICONS.image;
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return ICONS.video;
  if (['mp3', 'wav', 'm4a', 'flac', 'aac'].includes(ext)) return ICONS.audio;
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'json', 'html', 'css', 'sql'].includes(ext)) return ICONS.code;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return ICONS.archive;
  if (['txt', 'md', 'csv', 'log'].includes(ext)) return ICONS.text;
  return FileIcon;
}

export default function FileManager({ user, profile, refreshProfile }) {
  const [view, setView] = useState('drive'); // drive | starred | trash
  const [layout, setLayout] = useState('grid');
  const [folderId, setFolderId] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState([{ id: null, name: 'My Drive' }]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [uploads, setUploads] = useState([]); // [{ id, name, progress, error }]
  const [contextMenu, setContextMenu] = useState(null); // { x, y, item }
  const [viewerItem, setViewerItem] = useState(null);
  const [modal, setModal] = useState(null); // { type: 'new-folder'|'rename'|'move'|'copy'|'share'|'details', item }
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [toast, setToast] = useState('');

  const dropRef = useRef(null);
  const fileInputRef = useRef(null);

  // -------------------------------------------------------------------------
  // Online/offline + sync-queue status
  // -------------------------------------------------------------------------
  useEffect(() => {
    function goOnline() {
      setOnline(true);
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const detach = attachAutoSync((result) => {
      if (result.succeeded > 0) {
        setToast(`Synced ${result.succeeded} offline change${result.succeeded === 1 ? '' : 's'}`);
        setTimeout(() => setToast(''), 3000);
        refresh();
        refreshProfile?.();
      }
      refreshPendingCount();
    });
    refreshPendingCount();
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      detach();
    };
  }, []);

  async function refreshPendingCount() {
    const pending = await listPendingActions();
    setPendingCount(pending.length);
  }

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (search.trim()) {
        const rows = await searchItems(user.id, search.trim());
        setItems(rows);
        return;
      }
      if (view === 'trash') {
        const rows = await listFolder(user.id, null, { trashed: true });
        setItems(rows);
        return;
      }
      if (view === 'starred') {
        const { data, error } = await supabase
          .from('files_folders')
          .select('*')
          .eq('owner_id', user.id)
          .eq('is_starred', true)
          .eq('is_trashed', false);
        if (error) throw error;
        setItems(data);
        return;
      }
      const rows = await listFolder(user.id, folderId, { trashed: false });
      setItems(rows);
    } catch (err) {
      setToast(err.message);
      setTimeout(() => setToast(''), 4000);
    } finally {
      setLoading(false);
    }
  }, [user.id, view, folderId, search]);

  useEffect(() => {
    refresh();
    setSelected(new Set());
  }, [refresh]);

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------
  function openFolder(item) {
    setFolderId(item.id);
    setBreadcrumb((prev) => [...prev, { id: item.id, name: item.name }]);
    setView('drive');
    setSearch('');
  }

  function goToBreadcrumb(index) {
    const target = breadcrumb[index];
    setBreadcrumb(breadcrumb.slice(0, index + 1));
    setFolderId(target.id);
  }

  function changeView(next) {
    setView(next);
    if (next === 'drive') {
      setFolderId(null);
      setBreadcrumb([{ id: null, name: 'My Drive' }]);
    }
    setSearch('');
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------
  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  }

  // -------------------------------------------------------------------------
  // Upload (files, folders, drag-and-drop)
  // -------------------------------------------------------------------------
  function trackUpload(id, name) {
    setUploads((prev) => [...prev, { id, name, progress: 0, error: null }]);
  }
  function updateUpload(id, patch) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }
  function clearFinishedUploadsSoon() {
    setTimeout(() => setUploads((prev) => prev.filter((u) => u.progress < 100 && !u.error)), 2500);
  }

  async function handleUploadFiles(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      const uid = `${file.name}-${Date.now()}-${Math.random()}`;
      trackUpload(uid, file.name);
      try {
        await uploadFile(user.id, folderId, file, { onProgress: (p) => updateUpload(uid, { progress: p }) });
        updateUpload(uid, { progress: 100 });
      } catch (err) {
        updateUpload(uid, { error: err.message });
      }
    }
    clearFinishedUploadsSoon();
    refresh();
    refreshProfile?.();
  }

  async function handleUploadFolder(fileList) {
    const entries = flattenFileList(fileList);
    const uid = `folder-${Date.now()}`;
    trackUpload(uid, `Uploading ${entries.length} files…`);
    await uploadFileTree(user.id, folderId, entries, {
      onFileComplete: () => updateUpload(uid, { progress: 100 }),
      onFileError: (entry, err) => updateUpload(uid, { error: `${entry.file.name}: ${err.message}` })
    });
    clearFinishedUploadsSoon();
    refresh();
    refreshProfile?.();
  }

  const handleDrop = useCallback(
    async (e) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.items && e.dataTransfer.items.length) {
        const entries = await flattenDataTransferItems(e.dataTransfer.items);
        const uid = `drop-${Date.now()}`;
        trackUpload(uid, `Uploading ${entries.length} item${entries.length === 1 ? '' : 's'}…`);
        await uploadFileTree(user.id, folderId, entries, {
          onFileError: (entry, err) => updateUpload(uid, { error: `${entry.file.name}: ${err.message}` })
        });
        updateUpload(uid, { progress: 100 });
        clearFinishedUploadsSoon();
        refresh();
        refreshProfile?.();
      }
    },
    [folderId, user.id, refresh]
  );

  // -------------------------------------------------------------------------
  // Context menu actions
  // -------------------------------------------------------------------------
  async function handleContextAction(action, item) {
    try {
      switch (action) {
        case 'open':
          if (item.is_folder) openFolder(item);
          else setViewerItem(item);
          break;
        case 'open-with-google-docs':
        case 'open-with-office':
        case 'open-with-local':
          setViewerItem(item); // FileViewerModal surfaces the external-viewer fallback UI
          break;
        case 'share':
          setModal({ type: 'share', item });
          break;
        case 'copy':
          setModal({ type: 'copy', item });
          break;
        case 'move':
          setModal({ type: 'move', item });
          break;
        case 'rename':
          setModal({ type: 'rename', item });
          break;
        case 'details':
          setModal({ type: 'details', item });
          break;
        case 'star':
          await toggleStar(item);
          refresh();
          break;
        case 'download':
          await downloadItem(item);
          break;
        case 'trash':
          await trashItem(item);
          refresh();
          refreshProfile?.();
          break;
        case 'restore':
          await restoreItem(item);
          refresh();
          refreshProfile?.();
          break;
        case 'purge':
          await purgeItem(item);
          refresh();
          break;
        default:
          break;
      }
    } catch (err) {
      setToast(err.message);
      setTimeout(() => setToast(''), 4000);
    }
  }

  async function bulkAction(action) {
    const targets = items.filter((i) => selected.has(i.id));
    for (const item of targets) {
      // eslint-disable-next-line no-await-in-loop
      await handleContextAction(action, item);
    }
    setSelected(new Set());
  }

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------
  const previewableSiblings = useMemo(() => items.filter((i) => !i.is_folder), [items]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-950">
      <Sidebar
        view={view}
        onChangeView={changeView}
        profile={profile}
        isOnline={online}
        pendingCount={pendingCount}
        onUploadClick={() => fileInputRef.current?.click()}
        onNewFolderClick={() => setModal({ type: 'new-folder' })}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleUploadFiles(e.target.files)}
      />

      <main
        ref={dropRef}
        className="flex-1 flex flex-col min-w-0 relative"
        onDragOver={(e) => {
          e.preventDefault();
          if (view === 'drive') setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={view === 'drive' ? handleDrop : (e) => e.preventDefault()}
      >
        <Toolbar
          view={view}
          breadcrumb={breadcrumb}
          onBreadcrumbClick={goToBreadcrumb}
          search={search}
          onSearchChange={setSearch}
          layout={layout}
          onLayoutChange={setLayout}
          allSelected={items.length > 0 && selected.size === items.length}
          onToggleSelectAll={toggleSelectAll}
          selectedCount={selected.size}
          onUploadFiles={handleUploadFiles}
          onUploadFolder={handleUploadFolder}
          onNewFolder={() => setModal({ type: 'new-folder' })}
          onEmptyTrash={async () => {
            await emptyTrash(user.id);
            refresh();
          }}
          onBulkTrash={() => bulkAction('trash')}
          onBulkDelete={() => bulkAction('purge')}
        />

        {/* Upload progress tray */}
        {uploads.length > 0 && (
          <div className="absolute bottom-4 right-4 z-30 w-72 space-y-2">
            {uploads.map((u) => (
              <div key={u.id} className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 shadow-lg">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="truncate max-w-[70%] text-slate-200">{u.name}</span>
                  <span className={u.error ? 'text-red-400' : 'text-slate-400'}>
                    {u.error ? 'Failed' : `${u.progress}%`}
                  </span>
                </div>
                {!u.error && (
                  <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-accent-500 transition-all" style={{ width: `${u.progress}%` }} />
                  </div>
                )}
                {u.error && <p className="text-[11px] text-red-400 mt-0.5">{u.error}</p>}
              </div>
            ))}
          </div>
        )}

        {toast && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-slate-800 border border-slate-700 text-sm px-4 py-2 rounded-full shadow-lg">
            {toast}
          </div>
        )}

        {/* Drag overlay */}
        {dragActive && (
          <div className="absolute inset-0 z-20 bg-accent-500/10 border-2 border-dashed border-accent-400 m-4 rounded-2xl flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-accent-300">
              <UploadCloud size={40} />
              <p className="text-sm font-medium">Drop to upload here</p>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {loading ? (
            <div className="h-full flex items-center justify-center text-slate-500">
              <Loader2 className="animate-spin mr-2" size={18} /> Loading…
            </div>
          ) : items.length === 0 ? (
            <EmptyState view={view} search={search} />
          ) : layout === 'grid' ? (
            <GridView
              items={items}
              selected={selected}
              onToggleSelect={toggleSelect}
              onOpen={(item) => handleContextAction('open', item)}
              onContextMenu={(e, item) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, item });
              }}
              isTrashView={view === 'trash'}
            />
          ) : (
            <ListView
              items={items}
              selected={selected}
              onToggleSelect={toggleSelect}
              onOpen={(item) => handleContextAction('open', item)}
              onContextMenu={(e, item) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, item });
              }}
              isTrashView={view === 'trash'}
            />
          )}
        </div>
      </main>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          isTrashView={view === 'trash'}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      {viewerItem && (
        <FileViewerModal
          item={viewerItem}
          siblings={previewableSiblings}
          onNavigate={setViewerItem}
          onSaved={(updated) => {
            setViewerItem(updated);
            refresh();
            refreshProfile?.();
          }}
          onClose={() => setViewerItem(null)}
        />
      )}

      {modal?.type === 'new-folder' && (
        <NewFolderModal
          onCreate={async (name) => {
            await createFolder(user.id, folderId, name);
            refresh();
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'rename' && (
        <RenameModal
          item={modal.item}
          onRename={async (name) => {
            await renameItem(modal.item, name);
            refresh();
          }}
          onClose={() => setModal(null)}
        />
      )}

      {(modal?.type === 'move' || modal?.type === 'copy') && (
        <FolderPickerModal
          mode={modal.type}
          item={modal.item}
          rootLabel="My Drive"
          listFolder={(pid) => listFolder(user.id, pid, { trashed: false })}
          onConfirm={async (destId) => {
            if (modal.type === 'move') await moveItem(modal.item, destId);
            else await copyItem(user.id, modal.item, destId);
            refresh();
            refreshProfile?.();
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'share' && (
        <ShareModal
          item={modal.item}
          onCreateLink={(opts) => createShareLink(modal.item, opts)}
          onRevoke={async () => {
            await revokeShareLink(modal.item);
            refresh();
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'details' && <DetailsModal item={modal.item} onClose={() => setModal(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function EmptyState({ view, search }) {
  const message = search
    ? `No results for "${search}"`
    : view === 'trash'
    ? 'Trash is empty'
    : view === 'starred'
    ? "You haven't starred anything yet"
    : 'This folder is empty';
  return (
    <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
      <Folder size={36} className="opacity-40" />
      <p className="text-sm">{message}</p>
      {view === 'drive' && !search && <p className="text-xs">Drag and drop files here, or use the upload button.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function GridView({ items, selected, onToggleSelect, onOpen, onContextMenu, isTrashView }) {
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => {
        const Icon = iconFor(item);
        const isSelected = selected.has(item.id);
        return (
          <div
            key={item.id}
            onDoubleClick={() => onOpen(item)}
            onContextMenu={(e) => onContextMenu(e, item)}
            className={`group relative flex flex-col items-center gap-2 rounded-xl border p-4 cursor-pointer select-none transition-colors ${
              isSelected ? 'border-accent-500 bg-accent-500/10' : 'border-slate-800 hover:bg-slate-900'
            }`}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(item.id)}
              onClick={(e) => e.stopPropagation()}
              className="absolute top-2 left-2 accent-accent-500"
            />
            {!isTrashView && item.is_starred && (
              <Star size={13} className="absolute top-2.5 right-8 text-amber-400 fill-amber-400" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onContextMenu(e, item);
              }}
              className="absolute top-1.5 right-1.5 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-slate-800 text-slate-400"
            >
              <MoreVertical size={14} />
            </button>
            <Icon size={38} className={item.is_folder ? 'text-accent-400' : 'text-slate-400'} />
            <p className="text-xs text-center text-slate-200 truncate w-full">{item.name}</p>
            {!item.is_folder && <p className="text-[10px] text-slate-500">{formatBytes(item.size)}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ListView({ items, selected, onToggleSelect, onOpen, onContextMenu, isTrashView }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
          <th className="py-2 pl-2 w-8" />
          <th className="py-2">Name</th>
          <th className="py-2 w-28">Size</th>
          <th className="py-2 w-40">Modified</th>
          <th className="py-2 w-8" />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const Icon = iconFor(item);
          const isSelected = selected.has(item.id);
          return (
            <tr
              key={item.id}
              onDoubleClick={() => onOpen(item)}
              onContextMenu={(e) => onContextMenu(e, item)}
              className={`border-b border-slate-900 cursor-pointer ${isSelected ? 'bg-accent-500/10' : 'hover:bg-slate-900'}`}
            >
              <td className="pl-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(item.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="accent-accent-500"
                />
              </td>
              <td className="py-2.5 flex items-center gap-2.5">
                <Icon size={17} className={item.is_folder ? 'text-accent-400' : 'text-slate-400'} />
                <span className="truncate max-w-xs">{item.name}</span>
                {!isTrashView && item.is_starred && <Star size={12} className="text-amber-400 fill-amber-400" />}
              </td>
              <td className="text-slate-400">{item.is_folder ? '—' : formatBytes(item.size)}</td>
              <td className="text-slate-400">{new Date(item.updated_at).toLocaleDateString()}</td>
              <td>
                <button
                  onClick={(e) => onContextMenu(e, item)}
                  className="p-1 rounded-md hover:bg-slate-800 text-slate-400"
                >
                  <MoreVertical size={14} />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
