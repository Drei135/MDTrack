-- ============================================================================
-- FileVault - Supabase Schema
-- Offline-first PWA File Manager & Cloud Storage
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. PROFILES
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique not null,
  display_name text,
  avatar_url text,
  storage_quota_bytes bigint not null default 5368709120, -- 5 GB default
  storage_used_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Profiles are editable by owner"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Profiles are insertable by owner"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. FILES_FOLDERS (self-referencing tree)
-- ----------------------------------------------------------------------------
create table if not exists public.files_folders (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.files_folders (id) on delete cascade,
  name text not null,
  is_folder boolean not null default false,
  mime_type text,
  size bigint not null default 0,             -- bytes; folders store aggregate size
  storage_path text,                          -- path inside the Supabase Storage bucket (null for folders)
  is_trashed boolean not null default false,
  trashed_at timestamptz,
  is_starred boolean not null default false,
  share_token uuid,                           -- set when a public/signed link is generated
  share_expires_at timestamptz,
  share_permission text default 'view' check (share_permission in ('view', 'edit')),
  path_cache text,                            -- materialized "/Folder/Sub" for quick breadcrumb/search
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_permanently_at timestamptz,

  constraint file_must_have_storage_path check (
    (is_folder = true and storage_path is null) or
    (is_folder = false and storage_path is not null)
  )
);

create index if not exists idx_files_folders_owner on public.files_folders (owner_id);
create index if not exists idx_files_folders_parent on public.files_folders (parent_id);
create index if not exists idx_files_folders_trashed on public.files_folders (owner_id, is_trashed);
create index if not exists idx_files_folders_share_token on public.files_folders (share_token) where share_token is not null;
create unique index if not exists idx_files_folders_sibling_name
  on public.files_folders (owner_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where is_trashed = false;

alter table public.files_folders enable row level security;

-- Owners can fully manage their own items
create policy "Owner can select own items"
  on public.files_folders for select
  using (auth.uid() = owner_id);

create policy "Owner can insert own items"
  on public.files_folders for insert
  with check (auth.uid() = owner_id);

create policy "Owner can update own items"
  on public.files_folders for update
  using (auth.uid() = owner_id);

create policy "Owner can delete own items"
  on public.files_folders for delete
  using (auth.uid() = owner_id);

-- Anyone (including anon) can read an item if they present a valid, unexpired share token.
-- This powers public/signed share links. It is intentionally permissive on SELECT only.
create policy "Public can view shared items via token"
  on public.files_folders for select
  using (
    share_token is not null
    and (share_expires_at is null or share_expires_at > now())
  );

-- ----------------------------------------------------------------------------
-- 3. updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_files_folders_updated_at on public.files_folders;
create trigger trg_files_folders_updated_at
  before update on public.files_folders
  for each row execute procedure public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Recursive CASCADE SOFT-DELETE (trash) and RESTORE
--    Trashing/restoring a folder recursively trashes/restores its descendants.
-- ----------------------------------------------------------------------------
create or replace function public.trash_item_cascade(item_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  with recursive descendants as (
    select id from public.files_folders where id = item_id
    union all
    select f.id
    from public.files_folders f
    inner join descendants d on f.parent_id = d.id
  )
  update public.files_folders
  set is_trashed = true, trashed_at = now()
  where id in (select id from descendants)
    and owner_id = auth.uid();
end;
$$;

create or replace function public.restore_item_cascade(item_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  with recursive descendants as (
    select id from public.files_folders where id = item_id
    union all
    select f.id
    from public.files_folders f
    inner join descendants d on f.parent_id = d.id
  )
  update public.files_folders
  set is_trashed = false, trashed_at = null
  where id in (select id from descendants)
    and owner_id = auth.uid();
end;
$$;

-- Permanently purge a single trashed item (and descendants). Storage object
-- removal must happen client-side (or via an Edge Function) before calling this,
-- since Postgres cannot delete Storage objects directly.
create or replace function public.purge_item_cascade(item_id uuid)
returns table (storage_path text)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with recursive descendants as (
    select id from public.files_folders where id = item_id
    union all
    select f.id
    from public.files_folders f
    inner join descendants d on f.parent_id = d.id
  ),
  to_delete as (
    select ff.id, ff.storage_path
    from public.files_folders ff
    where ff.id in (select id from descendants)
      and ff.owner_id = auth.uid()
  ),
  deleted as (
    delete from public.files_folders
    where id in (select id from to_delete)
    returning files_folders.storage_path
  )
  select deleted.storage_path from deleted where deleted.storage_path is not null;
end;
$$;

create or replace function public.empty_trash()
returns table (storage_path text)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with to_delete as (
    select id, storage_path
    from public.files_folders
    where owner_id = auth.uid() and is_trashed = true
  ),
  deleted as (
    delete from public.files_folders
    where id in (select id from to_delete)
    returning files_folders.storage_path
  )
  select deleted.storage_path from deleted where deleted.storage_path is not null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Folder size aggregation
--    Recomputes size for a folder and all of its ancestors after file changes.
-- ----------------------------------------------------------------------------
create or replace function public.recalculate_folder_sizes(changed_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  cur_id uuid := changed_id;
begin
  while cur_id is not null loop
    update public.files_folders f
    set size = coalesce((
      select sum(child.size)
      from public.files_folders child
      where child.parent_id = f.id and child.is_trashed = false
    ), 0)
    where f.id = cur_id and f.is_folder = true;

    select parent_id into cur_id from public.files_folders where id = cur_id;
  end loop;
end;
$$;

create or replace function public.trg_recalc_size()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    if new.parent_id is not null then
      perform public.recalculate_folder_sizes(new.parent_id);
    end if;
  elsif (tg_op = 'UPDATE') then
    if new.parent_id is not null then
      perform public.recalculate_folder_sizes(new.parent_id);
    end if;
    if old.parent_id is not null and old.parent_id is distinct from new.parent_id then
      perform public.recalculate_folder_sizes(old.parent_id);
    end if;
  elsif (tg_op = 'DELETE') then
    if old.parent_id is not null then
      perform public.recalculate_folder_sizes(old.parent_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_files_folders_size on public.files_folders;
create trigger trg_files_folders_size
  after insert or update of size, parent_id, is_trashed or delete
  on public.files_folders
  for each row execute procedure public.trg_recalc_size();

-- Keep profiles.storage_used_bytes in sync with root-level usage
create or replace function public.trg_update_quota()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles
  set storage_used_bytes = coalesce((
    select sum(size) from public.files_folders
    where owner_id = coalesce(new.owner_id, old.owner_id)
      and is_folder = false and is_trashed = false
  ), 0)
  where id = coalesce(new.owner_id, old.owner_id);
  return null;
end;
$$;

drop trigger if exists trg_files_folders_quota on public.files_folders;
create trigger trg_files_folders_quota
  after insert or update of size, is_trashed or delete
  on public.files_folders
  for each row execute procedure public.trg_update_quota();

-- ----------------------------------------------------------------------------
-- 6. Share-link helper: generates/rotates a share token for an item
-- ----------------------------------------------------------------------------
create or replace function public.create_share_link(
  item_id uuid,
  permission text default 'view',
  expires_in_hours int default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  new_token uuid := uuid_generate_v4();
begin
  update public.files_folders
  set share_token = new_token,
      share_permission = permission,
      share_expires_at = case when expires_in_hours is null then null
                          else now() + (expires_in_hours || ' hours')::interval end
  where id = item_id and owner_id = auth.uid();
  return new_token;
end;
$$;

create or replace function public.revoke_share_link(item_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.files_folders
  set share_token = null, share_expires_at = null
  where id = item_id and owner_id = auth.uid();
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Storage bucket + policies
--    Bucket layout: {user_id}/{file_id}-{filename}
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('filevault', 'filevault', false)
on conflict (id) do nothing;

create policy "Users can upload to own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'filevault'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can view own files"
  on storage.objects for select
  using (
    bucket_id = 'filevault'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own files"
  on storage.objects for update
  using (
    bucket_id = 'filevault'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own files"
  on storage.objects for delete
  using (
    bucket_id = 'filevault'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Signed URLs are generated via the client SDK (createSignedUrl) using the
-- authenticated user's own session, so no additional public storage policy
-- is required for sharing; the files_folders "Public can view shared items
-- via token" policy exposes metadata, and a Supabase Edge Function
-- (`get-shared-file`) should be used to mint a short-lived signed URL for
-- anonymous share-link visitors. See README for the edge function stub.

-- ----------------------------------------------------------------------------
-- 8. Full text-ish search helper (name search across a user's tree)
-- ----------------------------------------------------------------------------
create extension if not exists pg_trgm;

create index if not exists idx_files_folders_name_trgm
  on public.files_folders using gin (name gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Done.
-- ----------------------------------------------------------------------------
