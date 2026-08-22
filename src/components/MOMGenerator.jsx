import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  X,
  ArrowRight,
  ArrowLeft,
  FileDown,
  Loader2,
  FileText,
  ClipboardList,
  Trash2,
  CheckCircle2
} from 'lucide-react';
import {
  listMeetingNotes,
  blankMeetingNote,
  normalizeMeetingNote,
  saveMeetingNoteDraft,
  deleteMeetingNote,
  agendaToMinutes,
  exportMeetingNoteToFileManager,
  VENUE_OPTIONS,
  isValidMeetingTime,
  formatTime12h,
  formatMeetingDate,
  getIncompleteFields
} from '../lib/momOps';
import { listCommittees, momCommitteeLabels, listOfficers, getAdviser } from '../lib/orgOps';

export default function MOMGenerator({ user }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [committeeOptions, setCommitteeOptions] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [adviser, setAdviser] = useState(null);
  const [active, setActive] = useState(null); // the note currently being edited, or null for the list view
  const [step, setStep] = useState(1);
  const [toast, setToast] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [n, rows] = await Promise.all([listMeetingNotes(), listCommittees()]);
      setNotes(n);
      setCommitteeOptions(momCommitteeLabels(rows));
      setOfficers(listOfficers(rows));
      setAdviser(getAdviser(rows));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function startNew() {
    setActive(normalizeMeetingNote(blankMeetingNote(user.id), momCommitteeLabels([])));
    setStep(1);
  }

  function openExisting(note) {
    setActive(note);
    setStep(note.minutes?.length ? 2 : 1);
  }

  async function handleDelete(id) {
    await deleteMeetingNote(id);
    refresh();
  }

  if (active) {
    return (
      <MOMModal
        user={user}
        note={active}
        step={step}
        setStep={setStep}
        committeeOptions={committeeOptions}
        officers={officers}
        adviser={adviser}
        onExit={() => {
          setActive(null);
          refresh();
        }}
        onToast={(m) => {
          setToast(m);
          setTimeout(() => setToast(''), 3000);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 md:px-6 py-3 border-b border-slate-800 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Meeting Notes</h1>
        <button
          onClick={startNew}
          className="flex items-center gap-1.5 bg-accent-500 hover:bg-accent-600 text-sm px-3 py-2 rounded-xl"
        >
          <Plus size={15} /> New MOM
        </button>
      </div>

      {toast && <div className="mx-4 mt-2 text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">{toast}</div>}

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-500">
            <Loader2 className="animate-spin mr-2" size={18} /> Loading…
          </div>
        ) : notes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
            <ClipboardList size={32} className="opacity-40" />
            <p className="text-sm">No meeting notes yet — create your first MOM.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {notes.map((note) => (
              <div
                key={note.id}
                onClick={() => openExisting(normalizeMeetingNote(note, committeeOptions))}
                className="cursor-pointer rounded-xl border border-slate-800 hover:bg-slate-900 p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <FileText size={18} className="text-accent-400" />
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${
                      note.status === 'final' ? 'bg-emerald-950/60 text-emerald-300' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {note.status === 'final' ? 'Published' : 'Draft'}
                  </span>
                </div>
                <p className="text-sm font-medium text-slate-100">
                  {note.meeting_title || formatMeetingDate(note.meeting_date) || 'Undated meeting'}
                </p>
                <p className="text-xs text-slate-500 truncate">{note.venue}</p>
                <div className="flex justify-between items-center pt-1">
                  <span className="text-[11px] text-slate-500">{(note.agenda || []).length} agenda items</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(note.id);
                    }}
                    className="p-1 rounded-md hover:bg-red-950/50 text-slate-500 hover:text-red-300"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "New Meeting" popup — a two-page wizard modal (Meeting Details & Agenda,
// then Minutes & Assignments) that always renders straight into the built-in
// MENDORO MOM letterhead on export. There is no custom-template upload; the
// layout in momDocx.js is the one and only template used every time.
// ---------------------------------------------------------------------------
function MOMModal({ user, note: initialNote, step, setStep, committeeOptions, officers, adviser, onExit, onToast }) {
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [agendaDraft, setAgendaDraft] = useState('');
  const [autosaveState, setAutosaveState] = useState('idle'); // idle | saving | saved

  // Google Docs-style autosave: any change to the note quietly saves the
  // draft ~1.5s after the user stops typing, so nothing is lost even if
  // they never hit "Save draft" themselves. Skips the very first render
  // (the note the modal opened with is already saved/unchanged).
  const skipFirstRef = useRef(true);
  const noteRef = useRef(note);
  noteRef.current = note;
  useEffect(() => {
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      setAutosaveState('saving');
      try {
        // Autosave persists the draft but doesn't feed the server response
        // back into `note` — doing so would change the note reference and
        // re-trigger this same effect, autosaving in a loop.
        await saveMeetingNoteDraft(noteRef.current);
        setAutosaveState('saved');
      } catch {
        setAutosaveState('idle');
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [note]);

  // Fields still missing/invalid, recalculated as the user types. Page 1
  // never blocks on this — it's only used to warn on Page 2 and to stop
  // the final "Add & Save".
  const incompleteFields = useMemo(() => getIncompleteFields(note), [note]);

  function patch(fields) {
    setNote((prev) => ({ ...prev, ...fields }));
  }

  function addAgendaItem() {
    if (!agendaDraft.trim()) return;
    patch({ agenda: [...note.agenda, agendaDraft.trim()] });
    setAgendaDraft('');
  }
  function removeAgendaItem(idx) {
    patch({ agenda: note.agenda.filter((_, i) => i !== idx) });
  }

  function updateMinuteContent(idx, content) {
    const next = [...note.minutes];
    next[idx] = { ...next[idx], content };
    patch({ minutes: next });
  }

  function toggleCommittee(committee, selected) {
    patch({
      committee_assignments: {
        ...note.committee_assignments,
        [committee]: { ...note.committee_assignments[committee], selected }
      }
    });
  }
  function updateCommitteeInstructions(committee, instructions) {
    patch({
      committee_assignments: {
        ...note.committee_assignments,
        [committee]: { ...note.committee_assignments[committee], instructions }
      }
    });
  }

  function addDeadline() {
    patch({
      deadlines: [...note.deadlines, { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`, text: '', date: '' }]
    });
  }
  function updateDeadline(id, field, value) {
    patch({ deadlines: note.deadlines.map((d) => (d.id === id ? { ...d, [field]: value } : d)) });
  }
  function removeDeadline(id) {
    patch({ deadlines: note.deadlines.filter((d) => d.id !== id) });
  }

  // Page 1 -> Page 2: auto-save + generate Roman-numeral minute sections from
  // agenda. No completeness check here — empty fields are fine, the user can
  // fill them in on Page 2 and get flagged only when they try to save.
  async function goToStep2() {
    setError('');
    setSaving(true);
    try {
      const minutes = agendaToMinutes(note.agenda, note.minutes);
      const saved = await saveMeetingNoteDraft({ ...note, minutes });
      setNote({ ...note, ...saved, minutes });
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft() {
    setSaving(true);
    setError('');
    try {
      const saved = await saveMeetingNoteDraft(note);
      setNote((prev) => ({ ...prev, ...saved }));
      setAutosaveState('saved');
      onToast('Draft saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // "Add" -> save the note, then generate the .docx from the MOM template
  // (in code — see momDocx.js) and publish it into the File Manager.
  async function handleSaveAndExport() {
    if (incompleteFields.length > 0) {
      setError(`Please fill in before saving: ${incompleteFields.join(', ')}`);
      return;
    }
    setExporting(true);
    setError('');
    try {
      await saveMeetingNoteDraft(note);
      const { note: updated } = await exportMeetingNoteToFileManager(user.id, note, null, {
        adviserName: adviser?.name,
        adviserTitle: adviser?.title
      });
      setNote((prev) => ({ ...prev, ...updated }));
      onToast('Meeting notes saved to File Manager');
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center px-4 py-6 animate-fade-in">
      <div className="w-full max-w-lg max-h-[92vh] bg-mom-bg text-mom-ink rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-scale-in">
        {/* Header bar */}
        <div className="bg-mom-header px-5 py-3.5 flex items-center justify-between shrink-0">
          <h1 className="text-white text-[15px] font-semibold">New Meeting</h1>
          <button onClick={onExit} className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 pb-2 flex gap-2 shrink-0 border-b border-mom-line/60">
          <TabButton active={step === 1} onClick={() => setStep(1)}>
            1. Meeting Details &amp; Agenda
          </TabButton>
          <TabButton active={step === 2} onClick={goToStep2}>
            2. Minutes &amp; Assignments
          </TabButton>
        </div>

        {error && (
          <div className="mx-5 mt-3 text-xs bg-red-100 border border-red-300 text-red-700 rounded-lg px-3 py-2 shrink-0">
            {error}
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {step === 1 ? (
            <StepOne
              note={note}
              patch={patch}
              agendaDraft={agendaDraft}
              setAgendaDraft={setAgendaDraft}
              addAgendaItem={addAgendaItem}
              removeAgendaItem={removeAgendaItem}
              officers={officers}
            />
          ) : (
            <>
              {incompleteFields.length > 0 && (
                <div className="text-xs bg-amber-100 border border-amber-300 text-amber-800 rounded-lg px-3 py-2">
                  Still needed before you save: {incompleteFields.join(', ')}
                </div>
              )}
              <StepTwo
                note={note}
                patch={patch}
                committeeOptions={committeeOptions}
                officers={officers}
                adviser={adviser}
                updateMinuteContent={updateMinuteContent}
                toggleCommittee={toggleCommittee}
                updateCommitteeInstructions={updateCommitteeInstructions}
                addDeadline={addDeadline}
                updateDeadline={updateDeadline}
                removeDeadline={removeDeadline}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-mom-line/60 px-5 py-3.5 flex items-center justify-between shrink-0 bg-mom-panel/40">
          {step === 2 ? (
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border border-mom-line text-mom-ink hover:bg-mom-panel"
            >
              <ArrowLeft size={14} /> Back
            </button>
          ) : (
            <button
              onClick={onExit}
              className="text-sm px-3.5 py-2 rounded-lg border border-mom-line text-mom-ink hover:bg-mom-panel"
            >
              Cancel
            </button>
          )}

          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-mom-sub px-2">
              {autosaveState === 'saving' ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Saving…
                </>
              ) : autosaveState === 'saved' ? (
                <>
                  <CheckCircle2 size={12} /> Saved
                </>
              ) : null}
            </span>
            <button
              onClick={handleSaveDraft}
              disabled={saving}
              title="Changes save automatically — this saves immediately"
              className="hidden sm:flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg text-mom-sub hover:bg-mom-panel disabled:opacity-60"
            >
              {saving && <Loader2 size={13} className="animate-spin" />} Save now
            </button>
            {step === 1 ? (
              <button
                onClick={goToStep2}
                disabled={saving}
                className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-mom-header text-white hover:opacity-90 disabled:opacity-60"
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                Next: Minutes of Proceedings <ArrowRight size={14} />
              </button>
            ) : (
              <button
                onClick={handleSaveAndExport}
                disabled={exporting}
                className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-mom-header text-white hover:opacity-90 disabled:opacity-60"
              >
                {exporting ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={14} />}
                Add &amp; Save
              </button>
            )}
          </div>
        </div>

        {note.exported_file_id && step === 2 && (
          <div className="flex items-center gap-1.5 justify-center pb-2.5 text-[11px] text-emerald-700 bg-mom-panel/40">
            <CheckCircle2 size={12} /> Already saved to File Manager — saving again will replace the document.
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] font-medium px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? 'bg-mom-accent2 border-mom-accent2 text-white'
          : 'bg-transparent border-mom-line text-mom-accent2 hover:bg-mom-panel'
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PAGE 1 — Meeting Details & Agenda
// ---------------------------------------------------------------------------
function StepOne({ note, patch, agendaDraft, setAgendaDraft, addAgendaItem, removeAgendaItem, officers }) {
  return (
    <div className="space-y-5">
      <div className="bg-mom-panel border border-mom-line rounded-xl p-4">
        <p className="text-[10px] font-semibold tracking-wide text-mom-label uppercase">Page 1</p>
        <h2 className="text-base font-bold text-mom-ink mt-0.5">Meeting Details &amp; Agenda</h2>
        <p className="text-xs text-mom-sub mt-1">
          Enter the meeting information and build the agenda. Your entries are retained when you continue to Page 2.
        </p>
      </div>

      <Field label="Meeting Title">
        <input
          value={note.meeting_title}
          onChange={(e) => patch({ meeting_title: e.target.value })}
          placeholder="Enter meeting title"
          className="w-full bg-white border border-mom-line rounded-lg px-3 py-2.5 text-sm text-mom-ink placeholder:text-mom-sub/70 focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input
            type="date"
            value={note.meeting_date || ''}
            onChange={(e) => patch({ meeting_date: e.target.value })}
            className="w-full bg-white border border-mom-line rounded-lg px-3 py-2.5 text-sm text-mom-ink focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
          />
        </Field>
        <Field label="Time">
          <input
            type="time"
            value={note.meeting_time || ''}
            onChange={(e) => patch({ meeting_time: e.target.value })}
            className="w-full bg-white border border-mom-line rounded-lg px-3 py-2.5 text-sm text-mom-ink focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
          />
        </Field>
      </div>
      {note.meeting_time && (
        <p className="text-xs -mt-3 text-mom-sub">
          {isValidMeetingTime(note.meeting_time) ? (
            formatTime12h(note.meeting_time)
          ) : (
            <span className="text-red-600">Meeting time must not exceed 8:00 PM.</span>
          )}
        </p>
      )}

      <Field label="Venue">
        <select
          value={note.venue}
          onChange={(e) => patch({ venue: e.target.value })}
          className="w-full bg-white border border-mom-line rounded-lg px-3 py-2.5 text-sm text-mom-ink focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
        >
          {VENUE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Presiding Officer">
        <select
          value={note.presiding_officer}
          onChange={(e) => patch({ presiding_officer: e.target.value })}
          className="w-full bg-white border border-mom-line rounded-lg px-3 py-2.5 text-sm text-mom-ink focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
        >
          <option value="">Select presiding officer</option>
          {officers.map((o) => (
            <option key={o.id} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-mom-sub mt-1">Officers are loaded from the saved Committee organization chart.</p>
      </Field>

      <Field label="Number of Attendees">
        <input
          type="number"
          min={0}
          value={note.attendees_count}
          onChange={(e) => patch({ attendees_count: Number(e.target.value) })}
          className="w-full bg-white border border-mom-line rounded-lg px-3 py-2.5 text-sm text-mom-ink focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
        />
      </Field>

      <div>
        <span className="text-xs uppercase tracking-wide text-mom-label font-semibold">Agenda</span>
        <p className="text-xs text-mom-sub mt-0.5 mb-2">Add the agenda bullets here. Each bullet will become a title on Page 2.</p>
        <div className="border border-mom-line rounded-lg bg-white p-3 min-h-[54px]">
          {note.agenda.length === 0 ? (
            <p className="text-xs text-mom-sub/80">No agenda items yet. Click "Add bullet" to begin.</p>
          ) : (
            <div className="space-y-1.5">
              {note.agenda.map((item, i) => (
                <div key={i} className="flex items-center justify-between bg-mom-bg rounded-lg px-3 py-1.5 text-sm">
                  <span>{i + 1}. {item}</span>
                  <button onClick={() => removeAgendaItem(i)} className="text-mom-sub hover:text-red-600">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-2">
          <input
            value={agendaDraft}
            onChange={(e) => setAgendaDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAgendaItem())}
            placeholder="Enter an agenda item"
            className="flex-1 bg-white border border-mom-line rounded-lg px-3 py-2 text-sm text-mom-ink focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
          />
          <button
            onClick={addAgendaItem}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-mom-accent2 text-white hover:opacity-90"
          >
            <Plus size={14} /> Add agenda bullet
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PAGE 2 — Minutes of Proceedings, Committee Assignments, Deadlines, Sign-off
// ---------------------------------------------------------------------------
function StepTwo({
  note,
  committeeOptions,
  officers,
  adviser,
  updateMinuteContent,
  toggleCommittee,
  updateCommitteeInstructions,
  addDeadline,
  updateDeadline,
  removeDeadline,
  patch
}) {
  const officerNames = [...new Set(officers.map((o) => o.name))];

  return (
    <div className="space-y-6">
      <div className="bg-mom-panel border border-mom-line rounded-xl p-4">
        <p className="text-[10px] font-semibold tracking-wide text-mom-label uppercase">Page 2</p>
        <h2 className="text-base font-bold text-mom-ink mt-0.5">Minutes of Proceedings &amp; Meeting Actions</h2>
        <p className="text-xs text-mom-sub mt-1">
          The agenda from Page 1 is shown below as Roman-numeral titles. Enter the minutes for each agenda item in its own textbox.
        </p>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mom-label mb-2">Minutes of Proceedings</h3>
        <div className="space-y-3">
          {note.minutes.map((section, idx) => (
            <div key={section.roman} className="border border-mom-line rounded-xl p-3 bg-white">
              <p className="text-sm font-semibold text-mom-accent mb-1.5">
                {section.roman}. {section.title}
              </p>
              <textarea
                value={section.content}
                onChange={(e) => updateMinuteContent(idx, e.target.value)}
                rows={3}
                placeholder={`Enter minutes/proceedings for ${section.title}…`}
                className="w-full bg-mom-bg border border-mom-line rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mom-label mb-1">Committee Assignments</h3>
        <p className="text-xs text-mom-sub mb-2">
          Committees listed here come from the Committee tab. Select the committees you need and enter the assignment for each selected committee.
        </p>
        <div className="space-y-2">
          {committeeOptions.map((committee) => {
            const entry = note.committee_assignments[committee] || { selected: false, instructions: '' };
            return (
              <div
                key={committee}
                className={`flex items-start gap-2.5 border rounded-lg p-2.5 ${
                  entry.selected ? 'bg-white border-mom-lineStrong' : 'bg-mom-panel/40 border-mom-line'
                }`}
              >
                <input
                  type="checkbox"
                  checked={entry.selected}
                  onChange={(e) => toggleCommittee(committee, e.target.checked)}
                  className="mt-2 w-4 h-4 accent-[#c97c3d] shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-mom-accent">{committee}</p>
                  <input
                    value={entry.instructions}
                    onChange={(e) => updateCommitteeInstructions(committee, e.target.value)}
                    placeholder={`Enter assignment for ${committee}`}
                    className="w-full mt-1 bg-white border border-mom-line rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
                  />
                </div>
              </div>
            );
          })}
          {committeeOptions.length === 0 && (
            <p className="text-xs text-mom-sub italic">No committees found — add them from the Committees &amp; Org Chart tab.</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mom-label mb-1">Important Deadlines</h3>
        <p className="text-xs text-mom-sub mb-2">Add each deadline as a bullet point.</p>
        <div className="space-y-2 mb-2">
          {note.deadlines.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <span className="text-mom-accent2 text-lg leading-none">•</span>
              <input
                value={d.text}
                onChange={(e) => updateDeadline(d.id, 'text', e.target.value)}
                placeholder="Deadline text"
                className="flex-1 bg-white border border-mom-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
              />
              <span className="text-mom-sub text-xs">-</span>
              <input
                type="date"
                value={d.date}
                onChange={(e) => updateDeadline(d.id, 'date', e.target.value)}
                className="bg-white border border-mom-line rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
              />
              <button onClick={() => removeDeadline(d.id)} className="p-1.5 text-mom-sub hover:text-red-600">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={addDeadline}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-mom-accent2 text-white hover:opacity-90"
        >
          <Plus size={13} /> Add deadline
        </button>
      </div>

      <Field label="Adjournment Time">
        <input
          type="time"
          value={note.adjournment_time || ''}
          onChange={(e) => patch({ adjournment_time: e.target.value })}
          className="w-full bg-white border border-mom-line rounded-lg px-3 py-2.5 text-sm text-mom-ink focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
        />
        {note.adjournment_time && <p className="text-xs text-mom-sub mt-1">{formatTime12h(note.adjournment_time)}</p>}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Prepared By">
          <select
            value={note.prepared_by}
            onChange={(e) => patch({ prepared_by: e.target.value })}
            className="w-full bg-white border border-mom-line rounded-lg px-3 py-2.5 text-sm text-mom-ink focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
          >
            <option value="">Select name</option>
            {officerNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reviewed By">
          <select
            value={note.reviewed_by}
            onChange={(e) => patch({ reviewed_by: e.target.value })}
            className="w-full bg-white border border-mom-line rounded-lg px-3 py-2.5 text-sm text-mom-ink focus:outline-none focus:ring-2 focus:ring-mom-accent2/40"
          >
            <option value="">Select name</option>
            {officerNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Adviser">
        <input
          value={adviser?.name || note.noted_by || 'Nelson A. Politchay'}
          readOnly
          className="w-full bg-mom-panel/60 border border-mom-line rounded-lg px-3 py-2.5 text-sm text-mom-ink cursor-not-allowed"
        />
        <p className="text-xs text-mom-sub mt-1">Loaded automatically from the Adviser seat on the org chart.</p>
      </Field>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-mom-label font-semibold">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
