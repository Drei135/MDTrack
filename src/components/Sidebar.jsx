import React from 'react';
import { HardDrive, Star, Trash2, CloudCog, WifiOff, UploadCloud } from 'lucide-react';
import { formatBytes } from '../lib/fileOps';

export default function Sidebar({ view, onChangeView, profile, isOnline, pendingCount, onUploadClick, onNewFolderClick }) {
  const used = profile?.storage_used_bytes ?? 0;
  const quota = profile?.storage_quota_bytes ?? 1;
  const pct = Math.min(100, Math.round((used / quota) * 100));

  const NavItem = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => onChangeView(id)}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        view === id ? 'bg-accent-500/15 text-accent-400' : 'text-slate-300 hover:bg-slate-800/70'
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-slate-800 bg-slate-950 h-full p-4">
      <div className="flex items-center gap-2 px-1 mb-6">
        <CloudCog className="text-accent-400" size={24} />
        <span className="font-semibold tracking-tight">FileVault</span>
      </div>

      <button
        onClick={onUploadClick}
        className="mb-2 flex items-center justify-center gap-2 bg-accent-500 hover:bg-accent-600 transition-colors rounded-xl py-2.5 text-sm font-medium"
      >
        <UploadCloud size={16} /> Upload
      </button>
      <button
        onClick={onNewFolderClick}
        className="mb-6 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 transition-colors rounded-xl py-2.5 text-sm font-medium"
      >
        New folder
      </button>

      <nav className="space-y-1">
        <NavItem id="drive" icon={HardDrive} label="My Drive" />
        <NavItem id="starred" icon={Star} label="Starred" />
        <NavItem id="trash" icon={Trash2} label="Trash" />
      </nav>

      <div className="mt-auto pt-4 space-y-3">
        {!isOnline && (
          <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded-lg px-2.5 py-2">
            <WifiOff size={13} />
            Offline{pendingCount > 0 ? ` · ${pendingCount} change${pendingCount === 1 ? '' : 's'} queued` : ''}
          </div>
        )}
        <div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-accent-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            {formatBytes(used)} of {formatBytes(quota)} used
          </p>
        </div>
      </div>
    </aside>
  );
}
