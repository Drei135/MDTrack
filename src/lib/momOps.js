import { supabase, isOnline } from './supabaseClient';
import { cacheRows, getCachedRows, upsertCachedRow, removeCachedRow, queueSuiteAction } from './offlineDbSuite';
import { uploadFile, updateFileContent } from './fileOps';

const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// ---------------------------------------------------------------------------
// Roman numeral conversion (I, II, III, IV, ... ) for agenda -> minutes.
// ---------------------------------------------------------------------------
const ROMAN_TABLE = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
];
export function toRoman(num) {
  let n = num;
  let out = '';
  for (const [value, symbol] of ROMAN_TABLE) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out;
}

/** Converts Page-1 agenda bullets into Page-2 Roman-numeral minute sections. */
export function agendaToMinutes(agenda, existingMinutes = []) {
  return agenda.map((item, i) => {
    const roman = toRoman(i + 1);
    const existing = existingMinutes.find((m) => m.title === item);
    return { roman, title: item, content: existing?.content ?? '' };
  });
}

export const VENUE_OPTIONS = [
  "BSU Men's Dormitory, Dining Hall",
  "BSU Men's Dormitory, Lobby",
  "BSU Men's Dormitory, Dining Hall & Lobby",
  "BSU Men's Dormitory, Store",
  "BSU Men's Dormitory Compound"
];

export const MAX_MEETING_TIME_MINUTES = 20 * 60; // 8:00 PM in minutes-from-midnight

/** Validates a 24h "HH:MM" time string against the 8:00 PM cutoff. */
export function isValidMeetingTime(hhmm) {
  if (!hhmm) return false;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  return h * 60 + m <= MAX_MEETING_TIME_MINUTES;
}

/**
 * Lists the required fields that are still empty (or, for meeting time,
 * invalid). Used to check completeness AFTER Page 2 / before the final
 * save — Page 1 no longer blocks on this, so users can move between
 * pages freely and only get flagged when they try to save.
 */
export function getIncompleteFields(note) {
  const missing = [];
  if (!note.meeting_title?.trim()) missing.push('Meeting title');
  if (!note.meeting_date) missing.push('Meeting date');
  if (!note.meeting_time) missing.push('Meeting time');
  else if (!isValidMeetingTime(note.meeting_time)) missing.push('Meeting time (must not exceed 8:00 PM)');
  if (!note.presiding_officer) missing.push('Presiding officer');
  if (!note.agenda || note.agenda.length === 0) missing.push('Agenda items');
  (note.minutes || []).forEach((m) => {
    if (!m.content?.trim()) missing.push(`Minutes for "${m.title}"`);
  });
  if (!note.prepared_by) missing.push('Prepared by');
  if (!note.reviewed_by) missing.push('Reviewed by');
  if (!note.adjournment_time) missing.push('Adjournment time');
  return missing;
}

export function formatTime12h(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function formatMeetingDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export async function listMeetingNotes() {
  if (isOnline()) {
    const { data, error } = await supabase
      .from('meeting_notes')
      .select('*')
      .order('meeting_date', { ascending: false });
    if (error) throw error;
    await cacheRows('meetingNotes', data);
    return data;
  }
  return getCachedRows('meetingNotes');
}

export function blankMeetingNote(ownerId) {
  return {
    id: uuid(),
    owner_id: ownerId,
    meeting_title: '',
    meeting_date: new Date().toISOString().slice(0, 10),
    meeting_time: '',
    attendees_count: 0,
    presiding_officer: '',
    prepared_by: '',
    reviewed_by: '',
    venue: VENUE_OPTIONS[0],
    agenda: [],
    minutes: [],
    // Keyed by committee name: { [committee]: { selected: boolean, instructions: string } }
    committee_assignments: {},
    // Array of { id, text, date }
    deadlines: [],
    adjournment_time: '',
    noted_by: 'NELSON A. POLITCHAY',
    noted_by_title: 'Adviser, MENDORO',
    status: 'draft',
    exported_file_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/**
 * Ensures a note (fresh, loaded from storage, or from an older draft saved
 * before this shape existed) has a checklist entry for every current
 * committee, and that deadlines are in the {id, text, date} shape. Safe to
 * call every time a note is opened.
 */
export function normalizeMeetingNote(note, committeeOptions = []) {
  const rawAssignments = note.committee_assignments;
  const assignments = {};
  // Legacy shape was an array of { committee, instructions }.
  const legacyByCommittee = Array.isArray(rawAssignments)
    ? Object.fromEntries(rawAssignments.map((a) => [a.committee, a]))
    : rawAssignments || {};
  for (const committee of committeeOptions) {
    const existing = legacyByCommittee[committee];
    assignments[committee] = {
      selected: existing ? Boolean(existing.selected ?? true) : false,
      instructions: existing?.instructions || ''
    };
  }

  const deadlines = (note.deadlines || []).map((d) =>
    typeof d === 'string' ? { id: uuid(), text: d, date: '' } : { id: d.id || uuid(), text: d.text || '', date: d.date || '' }
  );

  return {
    ...note,
    meeting_title: note.meeting_title || '',
    adjournment_time: note.adjournment_time || '',
    committee_assignments: assignments,
    deadlines
  };
}

/** Saves Page 1 (creates the row if it doesn't exist yet, else patches it). */
export async function saveMeetingNoteDraft(note) {
  await upsertCachedRow('meetingNotes', { ...note, updated_at: new Date().toISOString() });

  if (isOnline()) {
    const { data, error } = await supabase
      .from('meeting_notes')
      .upsert({ ...note, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) throw error;
    await upsertCachedRow('meetingNotes', data);
    return data;
  }
  await queueSuiteAction('meeting_note', 'create', note);
  return note;
}

export async function updateMeetingNote(id, patch) {
  const merged = { ...patch, updated_at: new Date().toISOString() };
  await upsertCachedRow('meetingNotes', { id, ...merged });
  if (isOnline()) {
    const { data, error } = await supabase.from('meeting_notes').update(patch).eq('id', id).select().single();
    if (error) throw error;
    await upsertCachedRow('meetingNotes', data);
    return data;
  }
  await queueSuiteAction('meeting_note', 'update', { id, ...patch });
  return { id, ...merged };
}

export async function deleteMeetingNote(id) {
  await removeCachedRow('meetingNotes', id);
  if (isOnline()) {
    const { error } = await supabase.from('meeting_notes').delete().eq('id', id);
    if (error) throw error;
  } else {
    await queueSuiteAction('meeting_note', 'delete', { id });
  }
}

// ---------------------------------------------------------------------------
// Document export — every field on the note is rendered straight into the
// MENDORO MOM letterhead layout as a real .docx (see momDocx.js, which
// reproduces MOM-Template_MM_DD_YY.docx in code), then saved into the shared
// File Manager via the existing (unmodified) fileOps.uploadFile.
// ---------------------------------------------------------------------------

/**
 * Builds the note into a .docx file and saves it into the shared File
 * Manager via the existing fileOps upload/update pipeline, then links the
 * resulting file back onto the meeting_notes row as `exported_file_id`.
 *
 * If this note was exported before, the SAME file is overwritten in place
 * (rather than uploaded again under the same generated name) — re-exporting
 * used to always insert a fresh row, which collided with the file-manager's
 * one-name-per-folder constraint on the second save. If the previously
 * exported file can no longer be found (renamed away/deleted/trashed), a
 * new file is created instead, with an automatically de-duplicated name.
 */
export async function exportMeetingNoteToFileManager(ownerId, note, folderId = null, docxOptions = {}) {
  if (!isOnline()) throw new Error('Exporting to the File Manager requires an internet connection.');
  const { buildMeetingNoteDocx } = await import('./momDocx');
  const blob = await buildMeetingNoteDocx(note, docxOptions);
  const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const safeDate = (note.meeting_date || 'undated').replace(/[^0-9-]/g, '');
  const fileName = `MOM_${safeDate}_${(note.venue || 'meeting').replace(/[^a-zA-Z0-9]+/g, '-')}.docx`;

  if (note.exported_file_id) {
    const { data: existing } = await supabase
      .from('files_folders')
      .select('*')
      .eq('id', note.exported_file_id)
      .eq('is_trashed', false)
      .maybeSingle();
    if (existing) {
      const fileRow = await updateFileContent({ ...existing, mime_type: mimeType }, blob);
      const updated = await updateMeetingNote(note.id, { status: 'final' });
      return { fileRow, note: updated };
    }
  }

  const file = new File([blob], fileName, { type: mimeType });
  const fileRow = await uploadFile(ownerId, folderId, file);
  const updated = await updateMeetingNote(note.id, { exported_file_id: fileRow.id, status: 'final' });
  return { fileRow, note: updated };
}
