import React, { useEffect, useRef, useState } from 'react';
import {
  FolderOpen,
  ExternalLink,
  Share2,
  Copy,
  Move,
  Pencil,
  Info,
  Trash2,
  Download,
  Star,
  RotateCcw,
  XCircle,
  ChevronRight
} from 'lucide-react';

/**
 * Positioned, keyboard-and-click-outside-dismissible context menu.
 *
 * Props:
 *  - x, y: viewport coordinates to anchor at
 *  - item: the files_folders row the menu is for
 *  - isTrashView: renders Restore/Delete forever instead of the normal set
 *  - onAction(actionKey, item): fired when a menu entry is chosen
 *  - onClose(): fired on outside click / escape
 */
export default function ContextMenu({ x, y, item, isTrashView = false, onAction, onClose }) {
  const ref = useRef(null);
  const [openWithSub, setOpenWithSub] = useState(false);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  useEffect(() => {
    // Keep the menu on-screen near viewport edges.
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const nextX = Math.min(x, window.innerWidth - rect.width - 8);
    const nextY = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, nextX), y: Math.max(8, nextY) });
  }, [x, y]);

  const openWithOptions = [
    { key: 'open-with-google-docs', label: 'Google Docs Viewer' },
    { key: 'open-with-office', label: 'Microsoft Office Viewer' },
    { key: 'open-with-local', label: 'Local app (protocol handler)' }
  ];

  function fire(actionKey) {
    onAction(actionKey, item);
    onClose();
  }

  const Item = ({ icon: Icon, label, actionKey, danger, hasSubmenu }) => (
    <button
      onClick={hasSubmenu ? undefined : () => fire(actionKey)}
      onMouseEnter={() => hasSubmenu && setOpenWithSub(true)}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded-md transition-colors ${
        danger ? 'text-red-300 hover:bg-red-950/60' : 'text-slate-200 hover:bg-slate-800'
      }`}
    >
      <Icon size={15} className={danger ? 'text-red-400' : 'text-slate-400'} />
      <span className="flex-1">{label}</span>
      {hasSubmenu && <ChevronRight size={14} className="text-slate-500" />}
    </button>
  );

  return (
    <div
      ref={ref}
      style={{ top: pos.y, left: pos.x }}
      className="fixed z-50 w-56 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1.5 animate-scale-in"
      role="menu"
    >
      {isTrashView ? (
        <>
          <Item icon={RotateCcw} label="Restore" actionKey="restore" />
          <Item icon={Info} label="Details" actionKey="details" />
          <div className="my-1 border-t border-slate-800" />
          <Item icon={XCircle} label="Delete forever" actionKey="purge" danger />
        </>
      ) : (
        <>
          <Item icon={item?.is_folder ? FolderOpen : ExternalLink} label="Open" actionKey="open" />
          <div
            className="relative"
            onMouseLeave={() => setOpenWithSub(false)}
          >
            <Item icon={ExternalLink} label="Open with" hasSubmenu />
            {openWithSub && (
              <div className="absolute left-full top-0 ml-1 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1.5">
                {openWithOptions.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => fire(opt.key)}
                    className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 rounded-md"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="my-1 border-t border-slate-800" />
          <Item icon={Share2} label="Share" actionKey="share" />
          <Item icon={Copy} label="Copy" actionKey="copy" />
          <Item icon={Move} label="Move" actionKey="move" />
          <Item icon={Pencil} label="Rename" actionKey="rename" />
          <Item icon={Star} label={item?.is_starred ? 'Remove star' : 'Add star'} actionKey="star" />
          <Item icon={Download} label="Download" actionKey="download" />
          <Item icon={Info} label="Details" actionKey="details" />
          <div className="my-1 border-t border-slate-800" />
          <Item icon={Trash2} label="Move to trash" actionKey="trash" danger />
        </>
      )}
    </div>
  );
}
