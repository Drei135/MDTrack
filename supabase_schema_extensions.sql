-- ============================================================================
-- FileVault Suite — Schema EXTENSION
-- Adds: Tasks, Meeting Notes (MOM), Committees/Org Chart, Notifications.
-- This file is purely additive: it does NOT alter any table, policy, or
-- function created by supabase_schema.sql. Run supabase_schema.sql first,
-- then run this file in the Supabase SQL editor.
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. COMMITTEES / ORG CHART
--    Shared, organization-wide data: every authenticated member of the org
--    can view AND edit it (this is a small student-org tool, not a
--    per-user-isolated resource like files_folders). group_order controls
--    the vertical tier in the chart; position_order controls left-to-right
--    order of officers within a tier.
-- ----------------------------------------------------------------------------
create table if not exists public.committees_officers (
  id uuid primary key default uuid_generate_v4(),
  group_name text not null,          -- e.g. 'Executives', 'Peace and Order'
  group_order int not null default 0,
  position_title text not null,      -- e.g. 'President', 'Sentinel'
  position_order int not null default 0,
  officer_name text default '',
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_committees_group_order on public.committees_officers (group_order, position_order);

alter table public.committees_officers enable row level security;

create policy "Authenticated members can view org chart"
  on public.committees_officers for select
  to authenticated
  using (true);

create policy "Authenticated members can edit org chart"
  on public.committees_officers for all
  to authenticated
  using (true)
  with check (true);

create or replace function public.set_updated_at_generic()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_committees_updated_at on public.committees_officers;
create trigger trg_committees_updated_at
  before update on public.committees_officers
  for each row execute procedure public.set_updated_at_generic();

-- Seed the default hierarchy described in the org chart spec. Safe to re-run
-- (guarded by a marker check) but intended as a one-time seed.
insert into public.committees_officers (group_name, group_order, position_title, position_order, officer_name)
select * from (values
  ('Adviser', 1, 'Adviser', 1, ''),
  ('Executives', 2, 'President', 1, ''),
  ('Executives', 2, 'Vice President', 2, ''),
  ('Executives', 2, 'Secretary', 3, ''),
  ('Executives', 2, 'Assistant Secretary', 4, ''),
  ('Finance and Resources', 3, 'Treasurer', 1, ''),
  ('Finance and Resources', 3, 'Assistant Treasurer', 2, ''),
  ('Finance and Resources', 3, 'Auditor', 3, ''),
  ('Finance and Resources', 3, 'Business Manager 1', 4, ''),
  ('Finance and Resources', 3, 'Business Manager 2', 5, ''),
  ('Peace and Order', 4, 'Sentinel 1', 1, ''),
  ('Peace and Order', 4, 'Sentinel 2', 2, ''),
  ('Peace and Order', 4, 'Sentinel 3', 3, ''),
  ('Peace and Order', 4, 'Sentinel 4', 4, ''),
  ('Peace and Order', 4, 'Sentinel 5', 5, ''),
  ('Peace and Order', 4, 'Sentinel 6', 6, ''),
  ('Program Coordinator (PIO)', 5, 'Program Coordinator', 1, ''),
  ('Music Directors', 6, 'Song Leader 1', 1, ''),
  ('Music Directors', 6, 'Song Leader 2', 2, ''),
  ('Music Directors', 6, 'Song Leader 3', 3, ''),
  ('Art and Illustration Designers', 7, 'Art Designer 1', 1, ''),
  ('Art and Illustration Designers', 7, 'Art Designer 2', 2, ''),
  ('Art and Illustration Designers', 7, 'Art Designer 3', 3, ''),
  ('Art and Illustration Designers', 7, 'Art Designer 4', 4, ''),
  ('Program Coordinator (Adonis)', 8, 'Program Coordinator', 1, '')
) as seed(group_name, group_order, position_title, position_order, officer_name)
where not exists (select 1 from public.committees_officers limit 1);

-- ----------------------------------------------------------------------------
-- 2. TASKS (Google Tasks style)
-- ----------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text default '',
  committees text[] not null default '{}',   -- selected group_name/position_title labels
  target_date date,
  is_done boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_owner on public.tasks (owner_id);
create index if not exists idx_tasks_target_date on public.tasks (target_date);
create index if not exists idx_tasks_done on public.tasks (is_done);

alter table public.tasks enable row level security;

-- Tasks are org-shared (any authenticated member can see and manage the
-- shared task board), mirroring committees_officers. If you want strictly
-- private per-user tasks instead, change `to authenticated using (true)`
-- below to `using (auth.uid() = owner_id)`.
create policy "Authenticated members can view tasks"
  on public.tasks for select
  to authenticated
  using (true);

create policy "Authenticated members can insert tasks"
  on public.tasks for insert
  to authenticated
  with check (auth.uid() = owner_id);

create policy "Authenticated members can update tasks"
  on public.tasks for update
  to authenticated
  using (true);

create policy "Owner can delete own tasks"
  on public.tasks for delete
  to authenticated
  using (auth.uid() = owner_id);

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute procedure public.set_updated_at_generic();

create table if not exists public.task_attachments (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  file_id uuid references public.files_folders (id) on delete set null,
  file_name text not null,
  storage_path text,
  mime_type text,
  size bigint default 0,
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_task_attachments_task on public.task_attachments (task_id);

alter table public.task_attachments enable row level security;

create policy "Authenticated members can view task attachments"
  on public.task_attachments for select
  to authenticated
  using (true);

create policy "Authenticated members can insert task attachments"
  on public.task_attachments for insert
  to authenticated
  with check (auth.uid() = uploaded_by);

create policy "Uploader can delete own attachments"
  on public.task_attachments for delete
  to authenticated
  using (auth.uid() = uploaded_by);

-- ----------------------------------------------------------------------------
-- 3. MEETING NOTES (MOM Generator)
-- ----------------------------------------------------------------------------
create table if not exists public.meeting_notes (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  -- Page 1 fields
  meeting_date date,
  meeting_time text,               -- stored as 'HH:MM AM/PM' string, validated client-side (<= 8:00 PM)
  attendees_count int default 0,
  presiding_officer text default '',
  prepared_by text default '',
  reviewed_by text default '',
  venue text default '',
  agenda jsonb not null default '[]',              -- string[]

  -- Page 2 fields
  minutes jsonb not null default '[]',              -- [{ roman: 'I', title: string, content: string }]
  committee_assignments jsonb not null default '[]',-- [{ committee: string, instructions: string }]
  deadlines jsonb not null default '[]',             -- string[]
  noted_by text not null default 'NELSON A. POLITCHAY',
  noted_by_title text not null default 'Adviser, MENDORO',

  status text not null default 'draft' check (status in ('draft', 'final')),
  exported_file_id uuid references public.files_folders (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_meeting_notes_owner on public.meeting_notes (owner_id);
create index if not exists idx_meeting_notes_date on public.meeting_notes (meeting_date);

alter table public.meeting_notes enable row level security;

create policy "Authenticated members can view meeting notes"
  on public.meeting_notes for select
  to authenticated
  using (true);

create policy "Authenticated members can insert meeting notes"
  on public.meeting_notes for insert
  to authenticated
  with check (auth.uid() = owner_id);

create policy "Authenticated members can update meeting notes"
  on public.meeting_notes for update
  to authenticated
  using (true);

create policy "Owner can delete own meeting notes"
  on public.meeting_notes for delete
  to authenticated
  using (auth.uid() = owner_id);

drop trigger if exists trg_meeting_notes_updated_at on public.meeting_notes;
create trigger trg_meeting_notes_updated_at
  before update on public.meeting_notes
  for each row execute procedure public.set_updated_at_generic();

-- ----------------------------------------------------------------------------
-- 4. NOTIFICATIONS
--    Populated by triggers below (new task assigned, file shared) and,
--    optionally, by a scheduled pg_cron job for upcoming-deadline reminders
--    (deadlines are time-based, not row-change-based, so they cannot be
--    generated by an ordinary trigger — see the pg_cron stub at the bottom).
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid references auth.users (id) on delete cascade, -- null = broadcast to all members
  type text not null check (type in ('task_assigned', 'task_due_soon', 'file_shared', 'mom_published')),
  title text not null,
  body text default '',
  related_id uuid,                 -- task id / file id / meeting_notes id, depending on type
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient on public.notifications (recipient_id, is_read);

alter table public.notifications enable row level security;

create policy "Members can view their own or broadcast notifications"
  on public.notifications for select
  to authenticated
  using (recipient_id is null or recipient_id = auth.uid());

create policy "Members can mark their notifications read"
  on public.notifications for update
  to authenticated
  using (recipient_id is null or recipient_id = auth.uid());

create policy "Authenticated members can create notifications"
  on public.notifications for insert
  to authenticated
  with check (true);

-- Broadcast a notification whenever a task is created (assigned to committees).
create or replace function public.notify_task_created()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (recipient_id, type, title, body, related_id)
  values (
    null,
    'task_assigned',
    'New task: ' || new.title,
    coalesce('Assigned to: ' || array_to_string(new.committees, ', '), ''),
    new.id
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_task_created on public.tasks;
create trigger trg_notify_task_created
  after insert on public.tasks
  for each row execute procedure public.notify_task_created();

-- Broadcast a notification whenever a file/folder's share link changes from
-- null to non-null (i.e. a new share was generated).
create or replace function public.notify_file_shared()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.share_token is not null and old.share_token is distinct from new.share_token) then
    insert into public.notifications (recipient_id, type, title, body, related_id)
    values (new.owner_id, 'file_shared', 'Share link created: ' || new.name, '', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_file_shared on public.files_folders;
create trigger trg_notify_file_shared
  after update of share_token on public.files_folders
  for each row execute procedure public.notify_file_shared();

-- Broadcast a notification when a MOM is marked final/published.
create or replace function public.notify_mom_published()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.status = 'final' and old.status is distinct from 'final') then
    insert into public.notifications (recipient_id, type, title, body, related_id)
    values (null, 'mom_published', 'Meeting minutes published', to_char(new.meeting_date, 'FMMonth DD, YYYY'), new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_mom_published on public.meeting_notes;
create trigger trg_notify_mom_published
  after update of status on public.meeting_notes
  for each row execute procedure public.notify_mom_published();

-- ----------------------------------------------------------------------------
-- 5. Deadline reminders (time-based, needs pg_cron — enable the extension in
--    Supabase's Database > Extensions UI, then run the schedule call below).
--    This inserts a 'task_due_soon' notification once per task, 24h before
--    its target_date, for any task that isn't done yet.
-- ----------------------------------------------------------------------------
create or replace function public.generate_due_soon_notifications()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (recipient_id, type, title, body, related_id)
  select null, 'task_due_soon', 'Due tomorrow: ' || t.title, coalesce(array_to_string(t.committees, ', '), ''), t.id
  from public.tasks t
  where t.is_done = false
    and t.target_date = (current_date + interval '1 day')::date
    and not exists (
      select 1 from public.notifications n
      where n.related_id = t.id and n.type = 'task_due_soon'
    );
end;
$$;

-- Run this once (requires the pg_cron extension enabled on the project):
-- select cron.schedule('due-soon-check', '0 8 * * *', $$select public.generate_due_soon_notifications();$$);

-- ----------------------------------------------------------------------------
-- 6. Realtime: add the new tables to the supabase_realtime publication so
--    the client can subscribe to INSERT/UPDATE/DELETE events.
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.meeting_notes;
alter publication supabase_realtime add table public.committees_officers;
alter publication supabase_realtime add table public.notifications;

-- ----------------------------------------------------------------------------
-- 7. Web Push subscriptions (used by src/components/Notifications.jsx's
--    subscribeToWebPush helper). Delivery to backgrounded devices requires a
--    server-side sender (e.g. a Supabase Edge Function using the `web-push`
--    library) that reads this table and POSTs to each stored endpoint when a
--    `notifications` row is inserted - not included here, since it runs
--    outside the client bundle.
-- ----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  subscription_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

create policy "Users manage their own push subscriptions"
  on public.push_subscriptions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Done. Existing supabase_schema.sql objects (profiles, files_folders, the
-- filevault storage bucket, trash/share RPCs, etc.) are untouched by this file.
-- ----------------------------------------------------------------------------
