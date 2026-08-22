-- Run this once in the Supabase SQL editor after pulling the updated MOM
-- Generator. Adds the two fields the new "New Meeting" form collects that
-- didn't exist in the original meeting_notes table (Meeting Title,
-- Adjournment Time), and switches committee_assignments' default to the
-- new checklist-object shape ({ [committee]: { selected, instructions } })
-- instead of the old array shape. Existing rows are left as-is — momOps.js
-- normalizes old-shape rows automatically when a note is opened, so this is
-- safe to run at any time and does not require touching existing data.

alter table public.meeting_notes
  add column if not exists meeting_title text default '',
  add column if not exists adjournment_time text default '';

alter table public.meeting_notes
  alter column committee_assignments set default '{}'::jsonb;
