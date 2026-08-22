import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  X,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ExternalLink,
  Loader2,
  FileWarning,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Save,
  Eye,
  Check
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { getSignedUrl, downloadItem, extensionOf, formatBytes, updateFileContent } from '../lib/fileOps';

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'];
const VIDEO_EXT = ['mp4', 'webm', 'ogg', 'mov', 'm4v'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];
const TEXT_EXT = ['txt', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'yml', 'yaml', 'csv', 'log', 'py', 'sql', 'sh'];
const MARKDOWN_EXT = ['md', 'markdown'];
const PDF_EXT = ['pdf'];
// Formats that cannot be rendered natively in-browser; offer external viewers.
const OFFICE_EXT = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
const DESIGN_EXT = ['psd', 'ai', 'sketch', 'fig', 'indd'];

function classify(ext) {
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (PDF_EXT.includes(ext)) return 'pdf';
  if (MARKDOWN_EXT.includes(ext)) return 'markdown';
  if (TEXT_EXT.includes(ext)) return 'text';
  if (OFFICE_EXT.includes(ext)) return 'office';
  if (DESIGN_EXT.includes(ext)) return 'design';
  return 'unsupported';
}

/**
 * Props:
 *  - item: files_folders row being viewed
 *  - siblings: optional array of items for prev/next navigation within the modal
 *  - onNavigate(item): fired when the user presses arrow keys / prev-next buttons
 *  - onSaved(updatedItem): fired after a successful in-app edit is saved
 *  - onClose()
 */
export default function FileViewerModal({ item, siblings = [], onNavigate, onSaved, onClose }) {
  const ext = useMemo(() => extensionOf(item?.name ?? ''), [item]);
  const kind = useMemo(() => classify(ext), [ext]);

  const [signedUrl, setSignedUrl] = useState(null);
  const [textContent, setTextContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const isEditableKind = kind === 'text' || kind === 'markdown';
  const [isEditing, setIsEditing] = useState(false);
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const isDirty = draftContent !== savedContent;

  const currentIndex = siblings.findIndex((s) => s.id === item?.id);
  const canPrev = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < siblings.length - 1;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      setZoom(1);
      setRotation(0);
      setPan({ x: 0, y: 0 });
      setIsEditing(false);
      setMarkdownPreview(false);
      setSaveError('');
      try {
        const url = await getSignedUrl(item, 3600);
        if (cancelled) return;
        setSignedUrl(url);
        if (kind === 'text' || kind === 'markdown') {
          const res = await fetch(url);
          const body = await res.text();
          if (!cancelled) {
            setTextContent(body);
            setDraftContent(body);
            setSavedContent(body);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load this file.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (item) load();
    return () => {
      cancelled = true;
    };
  }, [item, kind]);

  // Ref mirrors of state so the debounced autosave (set up once) always
  // sees the latest values without needing to be re-created on every keystroke.
  const draftRef = useRef(draftContent);
  const savedRef = useRef(savedContent);
  const savingRef = useRef(false);
  useEffect(() => {
    draftRef.current = draftContent;
  }, [draftContent]);
  useEffect(() => {
    savedRef.current = savedContent;
  }, [savedContent]);

  const handleSave = useCallback(
    async (contentOverride) => {
      const content = contentOverride ?? draftRef.current;
      setSaving(true);
      savingRef.current = true;
      setSaveError('');
      try {
        const updated = await updateFileContent(item, content);
        setSavedContent(content);
        savedRef.current = content;
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1500);
        onSaved?.(updated);
      } catch (err) {
        setSaveError(err.message || 'Could not save your changes.');
      } finally {
        setSaving(false);
        savingRef.current = false;
      }
    },
    [item, onSaved]
  );

  // Google Docs-style autosave: once editing, changes are saved automatically
  // ~1.2s after the user stops typing, with no need to click Save. The Save
  // button/Ctrl+S still work for an immediate save.
  useEffect(() => {
    if (!isEditing || !isEditableKind) return;
    if (draftContent === savedContent) return;
    const timer = setTimeout(() => {
      if (!savingRef.current && draftRef.current !== savedRef.current) {
        handleSave(draftRef.current);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [draftContent, savedContent, isEditing, isEditableKind, handleSave]);

  function requestClose() {
    if (isEditing && isDirty) {
      const ok = window.confirm('You have unsaved changes. Discard them and close?');
      if (!ok) return;
    }
    onClose();
  }

  function requestNavigate(next) {
    if (isEditing && isDirty) {
      const ok = window.confirm('You have unsaved changes. Discard them and continue?');
      if (!ok) return;
    }
    onNavigate(next);
  }

  const handleKey = useCallback(
    (e) => {
      const isSaveShortcut = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's';
      if (isSaveShortcut && isEditing) {
        e.preventDefault();
        handleSave();
        return;
      }
      if (e.key === 'Escape') requestClose();
      if (e.key === 'ArrowLeft' && canPrev && !isEditing) requestNavigate(siblings[currentIndex - 1]);
      if (e.key === 'ArrowRight' && canNext && !isEditing) requestNavigate(siblings[currentIndex + 1]);
    },
    [canPrev, canNext, currentIndex, siblings, isEditing, isDirty, draftContent]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  useEffect(() => {
    function warnBeforeUnload(e) {
      if (isEditing && isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isEditing, isDirty]);

  if (!item) return null;

  function onWheelZoom(e) {
    if (kind !== 'image') return;
    e.preventDefault();
    setZoom((z) => Math.min(6, Math.max(0.25, z - e.deltaY * 0.0015)));
  }

  function onMouseDownPan(e) {
    if (kind !== 'image' || zoom <= 1) return;
    setDragging({ startX: e.clientX - pan.x, startY: e.clientY - pan.y });
  }
  function onMouseMovePan(e) {
    if (!dragging) return;
    setPan({ x: e.clientX - dragging.startX, y: e.clientY - dragging.startY });
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-sm flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100 truncate max-w-[50vw]">{item.name}</p>
          <p className="text-xs text-slate-500">{formatBytes(item.size)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {kind === 'image' && (
            <>
              <IconBtn onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} icon={ZoomOut} label="Zoom out" />
              <span className="text-xs text-slate-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
              <IconBtn onClick={() => setZoom((z) => Math.min(6, z + 0.25))} icon={ZoomIn} label="Zoom in" />
              <IconBtn onClick={() => setRotation((r) => r + 90)} icon={RotateCw} label="Rotate" />
            </>
          )}

          {isEditableKind && !loading && !error && (
            <>
              {isEditing ? (
                <>
                  {saveError && <span className="text-xs text-red-400 mr-1">{saveError}</span>}
                  {!saveError && isDirty && !saving && (
                    <span className="text-xs text-slate-500 mr-1">Editing…</span>
                  )}
                  {kind === 'markdown' && (
                    <IconBtn
                      onClick={() => setMarkdownPreview((p) => !p)}
                      icon={markdownPreview ? Pencil : Eye}
                      label={markdownPreview ? 'Edit' : 'Preview'}
                    />
                  )}
                  <button
                    onClick={() => handleSave()}
                    disabled={saving || !isDirty}
                    title="Changes save automatically — this saves immediately"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : justSaved ? (
                      <Check size={14} />
                    ) : (
                      <Save size={14} />
                    )}
                    {saving ? 'Saving…' : justSaved ? 'Saved' : isDirty ? 'Save now' : 'Saved'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700"
                >
                  <Pencil size={14} /> Edit
                </button>
              )}
            </>
          )}

          <IconBtn onClick={() => downloadItem(item)} icon={Download} label="Download" />
          <IconBtn onClick={requestClose} icon={X} label="Close" />
        </div>
      </div>

      {/* Body */}
      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden select-none"
        onWheel={onWheelZoom}
        onMouseDown={onMouseDownPan}
        onMouseMove={onMouseMovePan}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
      >
        {canPrev && !isEditing && (
          <button
            onClick={() => requestNavigate(siblings[currentIndex - 1])}
            className="absolute left-3 z-10 p-2 rounded-full bg-slate-900/80 hover:bg-slate-800 border border-slate-700"
            aria-label="Previous file"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        {canNext && !isEditing && (
          <button
            onClick={() => requestNavigate(siblings[currentIndex + 1])}
            className="absolute right-3 z-10 p-2 rounded-full bg-slate-900/80 hover:bg-slate-800 border border-slate-700"
            aria-label="Next file"
          >
            <ChevronRight size={20} />
          </button>
        )}

        {loading && (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <Loader2 className="animate-spin" size={28} />
            <span className="text-sm">Loading preview…</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center gap-2 text-slate-400 max-w-sm text-center px-6">
            <FileWarning size={32} className="text-amber-400" />
            <p className="text-sm">{error}</p>
            <button
              onClick={() => downloadItem(item)}
              className="mt-2 text-sm px-3 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-600"
            >
              Download instead
            </button>
          </div>
        )}

        {!loading && !error && signedUrl && (
          <ViewerBody
            kind={kind}
            item={item}
            signedUrl={signedUrl}
            textContent={textContent}
            zoom={zoom}
            rotation={rotation}
            pan={pan}
            dragging={dragging}
            isEditing={isEditing}
            markdownPreview={markdownPreview}
            draftContent={draftContent}
            onDraftChange={setDraftContent}
          />
        )}
      </div>
    </div>
  );
}

function ViewerBody({
  kind,
  item,
  signedUrl,
  textContent,
  zoom,
  rotation,
  pan,
  dragging,
  isEditing,
  markdownPreview,
  draftContent,
  onDraftChange
}) {
  switch (kind) {
    case 'image':
      return (
        <img
          src={signedUrl}
          alt={item.name}
          draggable={false}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
            transition: dragging ? 'none' : 'transform 120ms ease-out'
          }}
          className="max-h-full max-w-full object-contain"
        />
      );

    case 'video':
      return (
        <video
          src={signedUrl}
          controls
          autoPlay
          className="max-h-full max-w-full rounded-lg shadow-2xl bg-black"
        />
      );

    case 'audio':
      return (
        <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col items-center gap-6">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center text-3xl">
            🎵
          </div>
          <p className="text-sm text-slate-300 truncate max-w-full">{item.name}</p>
          <audio src={signedUrl} controls autoPlay className="w-full" />
        </div>
      );

    case 'pdf':
      return (
        <iframe
          title={item.name}
          src={`${signedUrl}#toolbar=1&navpanes=0`}
          className="w-full h-full bg-white rounded-lg"
        />
      );

    case 'markdown':
      if (isEditing && !markdownPreview) {
        return (
          <textarea
            autoFocus
            value={draftContent}
            onChange={(e) => onDraftChange(e.target.value)}
            spellCheck={false}
            className="w-full max-w-4xl h-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-xs leading-relaxed text-slate-200 font-mono resize-none outline-none focus:ring-2 focus:ring-accent-500"
          />
        );
      }
      return (
        <div className="w-full max-w-3xl h-full overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl p-8 prose prose-invert prose-sm">
          <ReactMarkdown>{isEditing ? draftContent : textContent}</ReactMarkdown>
        </div>
      );

    case 'text':
      return isEditing ? (
        <textarea
          autoFocus
          value={draftContent}
          onChange={(e) => onDraftChange(e.target.value)}
          spellCheck={false}
          className="w-full max-w-4xl h-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-xs leading-relaxed text-slate-200 font-mono resize-none outline-none focus:ring-2 focus:ring-accent-500"
        />
      ) : (
        <pre className="w-full max-w-4xl h-full overflow-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 text-xs leading-relaxed text-slate-200 font-mono whitespace-pre-wrap">
          {draftContent}
        </pre>
      );

    case 'office':
      return <ExternalViewerFallback item={item} signedUrl={signedUrl} label="Office document" />;

    case 'design':
      return <ExternalViewerFallback item={item} signedUrl={signedUrl} label="Design file" />;

    default:
      return <ExternalViewerFallback item={item} signedUrl={signedUrl} label="This file" />;
  }
}

/** Shown for formats we cannot render natively: DOCX, XLSX, PSD, etc. */
function ExternalViewerFallback({ item, signedUrl, label }) {
  const encoded = encodeURIComponent(signedUrl);
  const googleDocsUrl = `https://docs.google.com/gview?url=${encoded}&embedded=true`;
  const officeUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encoded}`;

  return (
    <div className="max-w-md text-center px-6 flex flex-col items-center gap-4">
      <FileWarning size={40} className="text-amber-400" />
      <p className="text-sm text-slate-300">
        {label} can't be previewed directly in the browser. Open it with one of the viewers below, or
        download it to use your local app.
      </p>
      <div className="flex flex-col gap-2 w-full">
        <a
          href={googleDocsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700"
        >
          <ExternalLink size={15} /> Open with Google Docs Viewer
        </a>
        <a
          href={officeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700"
        >
          <ExternalLink size={15} /> Open with Office Web Viewer
        </a>
        <a
          href={signedUrl}
          className="flex items-center justify-center gap-2 text-sm px-4 py-2 rounded-lg bg-accent-500 hover:bg-accent-600"
        >
          <Download size={15} /> Download &amp; open locally
        </a>
      </div>
    </div>
  );
}

function IconBtn({ onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="p-2 rounded-lg hover:bg-slate-800 text-slate-300 transition-colors"
    >
      <Icon size={17} />
    </button>
  );
}
