import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Save, Loader2, Check, Eye, Code2, AlertTriangle } from 'lucide-react';
import { supabase, STORAGE_BUCKET } from '../lib/supabaseClient';
import { getSignedUrl, extensionOf, formatBytes } from '../lib/fileOps';
import { upsertCachedItem } from '../lib/offlineDb';

const EDITABLE_EXT = [
  'txt', 'md', 'markdown', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html',
  'yml', 'yaml', 'csv', 'log', 'py', 'sql', 'sh', 'xml'
];

export function isEditableFile(name) {
  return EDITABLE_EXT.includes(extensionOf(name));
}

/**
 * A lightweight, dependency-free code/text/markdown editor: a line-numbered
 * textarea with a live-preview split pane for Markdown. Autosaves to
 * Supabase Storage (overwriting the object in place) and mirrors the new
 * size/timestamp into the offline IndexedDB cache, on an explicit Save and
 * also on a debounced auto-save while the user is typing.
 *
 * Props: item (files_folders row), onClose(), onSaved(updatedItem)
 */
export default function FileEditorModal({ item, onClose, onSaved }) {
  const ext = useMemo(() => extensionOf(item.name), [item.name]);
  const isMarkdown = ext === 'md' || ext === 'markdown';
  const isJson = ext === 'json';

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [showPreview, setShowPreview] = useState(isMarkdown);

  const autoSaveTimer = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const url = await getSignedUrl(item, 3600);
        const res = await fetch(url);
        const body = await res.text();
        if (!cancelled) setContent(body);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load this file for editing.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [item]);

  useEffect(() => {
    if (isJson) {
      try {
        if (content.trim()) JSON.parse(content);
        setJsonError('');
      } catch (err) {
        setJsonError(err.message);
      }
    }
  }, [content, isJson]);

  function handleChange(value) {
    setContent(value);
    setDirty(true);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      save({ silent: true });
    }, 2500);
  }

  async function save({ silent = false } = {}) {
    if (isJson && jsonError) return; // don't persist invalid JSON
    if (!navigator.onLine) {
      setError('Editing requires an internet connection to save changes right now.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const blob = new Blob([content], { type: mimeForExt(ext) });
      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .update(item.storage_path, blob, { contentType: mimeForExt(ext), upsert: true });
      if (uploadErr) throw uploadErr;

      const newSize = blob.size;
      const { data, error: updateErr } = await supabase
        .from('files_folders')
        .update({ size: newSize })
        .eq('id', item.id)
        .select()
        .single();
      if (updateErr) throw updateErr;

      await upsertCachedItem(data);
      setDirty(false);
      setLastSavedAt(new Date());
      onSaved?.(data);
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const lineCount = content.split('\n').length;
  const lineNumbers = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'), [lineCount]);

  function handleTab(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = textareaRef.current;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = content.slice(0, start) + '  ' + content.slice(end);
      handleChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950 flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
        <div className="min-w-0 flex items-center gap-2">
          <Code2 size={16} className="text-accent-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-100 truncate max-w-[45vw]">{item.name}</p>
            <p className="text-xs text-slate-500">
              {formatBytes(item.size)}
              {saving ? ' · saving…' : dirty ? ' · unsaved changes' : lastSavedAt ? ' · saved' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isMarkdown && (
            <button
              onClick={() => setShowPreview((v) => !v)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700"
            >
              <Eye size={13} /> {showPreview ? 'Hide preview' : 'Show preview'}
            </button>
          )}
          <button
            onClick={() => save()}
            disabled={saving || (isJson && !!jsonError)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-600 disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : dirty ? <Save size={13} /> : <Check size={13} />}
            {saving ? 'Saving' : dirty ? 'Save' : 'Saved'}
          </button>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 text-slate-300">
            <X size={17} />
          </button>
        </div>
      </div>

      {(error || jsonError) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-950/40 border-b border-red-900 text-xs text-red-300">
          <AlertTriangle size={13} />
          {error || `Invalid JSON: ${jsonError}`}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-500">
          <Loader2 className="animate-spin mr-2" size={18} /> Loading file…
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div className={`flex-1 flex overflow-hidden ${showPreview ? 'border-r border-slate-800' : ''}`}>
            <pre
              aria-hidden
              className="select-none text-right text-xs leading-6 text-slate-600 font-mono py-4 px-2 bg-slate-900/60 overflow-hidden"
            >
              {lineNumbers}
            </pre>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleTab}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="flex-1 bg-slate-950 text-slate-100 font-mono text-xs leading-6 py-4 px-3 outline-none resize-none whitespace-pre overflow-auto"
            />
          </div>
          {isMarkdown && showPreview && (
            <div className="flex-1 overflow-y-auto p-6 prose prose-invert prose-sm max-w-none">
              <MarkdownPreview source={content} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Minimal dependency-free Markdown renderer covering headers, bold/italic,
 *  lists, links, and code fences — enough for a live preview pane without
 *  pulling in an extra parser library. */
function MarkdownPreview({ source }) {
  const html = useMemo(() => markdownToHtml(source), [source]);
  // eslint-disable-next-line react/no-danger
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function markdownToHtml(md) {
  const lines = escapeHtml(md).split('\n');
  const out = [];
  let inCodeBlock = false;
  let listBuffer = [];

  function flushList() {
    if (listBuffer.length) {
      out.push(`<ul>${listBuffer.map((li) => `<li>${li}</li>`).join('')}</ul>`);
      listBuffer = [];
    }
  }

  function inline(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      out.push(inCodeBlock ? '<pre><code>' : '</code></pre>');
      continue;
    }
    if (inCodeBlock) {
      out.push(line + '\n');
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) {
      flushList();
      out.push('<hr/>');
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)/);
    if (bullet) {
      listBuffer.push(inline(bullet[1]));
      continue;
    }
    flushList();
    if (line.trim() === '') continue;
    out.push(`<p>${inline(line)}</p>`);
  }
  flushList();
  return out.join('\n');
}

function mimeForExt(ext) {
  const map = {
    json: 'application/json',
    md: 'text/markdown',
    markdown: 'text/markdown',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    jsx: 'text/javascript',
    ts: 'text/typescript',
    tsx: 'text/typescript',
    csv: 'text/csv',
    xml: 'application/xml'
  };
  return map[ext] || 'text/plain';
}
