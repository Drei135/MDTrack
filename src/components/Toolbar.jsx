import React from 'react';
import {
  Search,
  LayoutGrid,
  List,
  CheckSquare,
  Square,
  Trash2,
  FolderPlus,
  UploadCloud,
  FolderUp,
  ChevronRight,
  X
} from 'lucide-react';

export default function Toolbar({
  view,
  breadcrumb,
  onBreadcrumbClick,
  search,
  onSearchChange,
  layout,
  onLayoutChange,
  allSelected,
  onToggleSelectAll,
  selectedCount,
  onUploadFiles,
  onUploadFolder,
  onNewFolder,
  onEmptyTrash,
  onBulkTrash,
  onBulkDelete
}) {
  return (
    <div className="border-b border-slate-800 px-4 md:px-6 py-3 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm text-slate-400 min-w-0 overflow-x-auto">
          {view === 'trash' ? (
            <span className="text-slate-100 font-medium">Trash</span>
          ) : view === 'starred' ? (
            <span className="text-slate-100 font-medium">Starred</span>
          ) : (
            breadcrumb.map((crumb, i) => (
              <React.Fragment key={crumb.id ?? 'root'}>
                {i > 0 && <ChevronRight size={14} className="text-slate-600 shrink-0" />}
                <button
                  onClick={() => onBreadcrumbClick(i)}
                  className={`whitespace-nowrap hover:text-slate-100 ${
                    i === breadcrumb.length - 1 ? 'text-slate-100 font-medium' : ''
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))
          )}
        </div>

        {/* Search */}
        <div className="flex-1 max-w-md min-w-[160px] relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search files and folders"
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-8 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent-500"
          />
          {search && (
            <button onClick={() => onSearchChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onLayoutChange('grid')}
            className={`p-2 rounded-lg ${layout === 'grid' ? 'bg-slate-800 text-accent-400' : 'text-slate-400 hover:bg-slate-800'}`}
            aria-label="Grid view"
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => onLayoutChange('list')}
            className={`p-2 rounded-lg ${layout === 'list' ? 'bg-slate-800 text-accent-400' : 'text-slate-400 hover:bg-slate-800'}`}
            aria-label="List view"
          >
            <List size={16} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onToggleSelectAll}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 px-2 py-1 rounded-md hover:bg-slate-800"
        >
          {allSelected ? <CheckSquare size={14} className="text-accent-400" /> : <Square size={14} />}
          Select all
        </button>

        {selectedCount > 0 && <span className="text-xs text-slate-500">{selectedCount} selected</span>}

        <div className="flex-1" />

        {view === 'trash' ? (
          <>
            {selectedCount > 0 && (
              <button
                onClick={onBulkDelete}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-red-300 hover:bg-red-950/50"
              >
                <Trash2 size={13} /> Delete selected forever
              </button>
            )}
            <button
              onClick={onEmptyTrash}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-red-950/60 border border-red-900 text-red-300 hover:bg-red-950"
            >
              <Trash2 size={13} /> Empty trash
            </button>
          </>
        ) : (
          <>
            {selectedCount > 0 && (
              <button
                onClick={onBulkTrash}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-red-300 hover:bg-red-950/50"
              >
                <Trash2 size={13} /> Move to trash
              </button>
            )}
            <label className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer">
              <UploadCloud size={13} /> Upload files
              <input type="file" multiple className="hidden" onChange={(e) => onUploadFiles(e.target.files)} />
            </label>
            <label className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer">
              <FolderUp size={13} /> Upload folder
              <input
                type="file"
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
                onChange={(e) => onUploadFolder(e.target.files)}
              />
            </label>
            <button
              onClick={onNewFolder}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700"
            >
              <FolderPlus size={13} /> New folder
            </button>
          </>
        )}
      </div>
    </div>
  );
}
