-- =====================================================================
--  Google course – Course Registration: database setup
--  Run once in Supabase: SQL Editor -> New query -> paste all -> Run.
--  Safe to run again (it updates what already exists).
--
--  BEFORE RUNNING: replace  your-admin-email@example.com  (bottom of file)
--  with the email of the admin user you create in Authentication -> Users.
-- =====================================================================

-- ---------- Admins (who may open the admin dashboard) ----------
create table if not exists public.admins (
  email text primary key
);
alter table public.admins enable row level security;   -- no policies: not readable from the browser

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;

-- ---------- Registrations ----------
create table if not exists public.registrations (
  id               uuid primary key default gen_random_uuid(),
  ref_no           text not null unique,
  created_at       timestamptz not null default now(),
  course           text not null,
  mapped_course    text not null,
  full_name        text not null,
  email            text not null,
  phone            text,
  gender           text,
  grad_year        text,
  organisation     text not null,
  profile_url      text not null,
  profile_name     text,
  profile_badges   integer,
  email_check      text,
  link_check       text,
  screenshot_check text,
  screenshot_path  text,
  screenshot2_path text,          -- second screenshot: public profile link
  status           text not null default 'Verified' check (status in ('Pending','Verified','Rejected')),
  reviewed_at      text,
  admin_note       text,
  badge_status     text,          -- latest Badge check result: Complete / In progress / Not started / …
  badges_done      integer,
  badges_required  integer,
  badge_checked_at text,
  password_hash    text,          -- optional student password: salted SHA-256 made in the browser
  constraint registrations_sizes check (
        char_length(full_name)    between 2 and 120
    and char_length(email)        between 5 and 254
    and char_length(organisation) <= 200
    and char_length(profile_url)  <= 300
    and coalesce(char_length(admin_note), 0) <= 2000
  )
);
-- Badge-check columns (added here too, in case the table was created by an older version of this script).
alter table public.registrations add column if not exists screenshot2_path text;
alter table public.registrations add column if not exists badge_status text;
alter table public.registrations add column if not exists badges_done integer;
alter table public.registrations add column if not exists badges_required integer;
alter table public.registrations add column if not exists badge_checked_at text;
alter table public.registrations add column if not exists password_hash text;

-- One registration per email ID and one per public profile (any course).
drop index if exists public.registrations_email_course_key;
create unique index if not exists registrations_email_key
  on public.registrations (lower(trim(email)));
create unique index if not exists registrations_profile_key
  on public.registrations (lower(substring(profile_url from 'public_profiles/([A-Za-z0-9-]+)')));
create index if not exists registrations_created_at_idx
  on public.registrations (created_at desc);

alter table public.registrations enable row level security;

-- Students (not logged in) may only ADD a verified registration. They can never read, change or delete rows.
drop policy if exists "students can register" on public.registrations;
create policy "students can register" on public.registrations
  for insert to anon, authenticated
  with check (
        status = 'Verified'
    and admin_note is null
    and badge_status is null and badges_done is null and badges_required is null and badge_checked_at is null
    and profile_url like 'https://www.skills.google/public_profiles/%'
  );

-- Admins may do everything.
drop policy if exists "admins read"   on public.registrations;
drop policy if exists "admins insert" on public.registrations;
drop policy if exists "admins update" on public.registrations;
drop policy if exists "admins delete" on public.registrations;
create policy "admins read"   on public.registrations for select to authenticated using (public.is_admin());
create policy "admins insert" on public.registrations for insert to authenticated with check (public.is_admin());
create policy "admins update" on public.registrations for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete" on public.registrations for delete to authenticated using (public.is_admin());

grant insert on public.registrations to anon;
grant select, insert, update, delete on public.registrations to authenticated;

-- "Already registered?" check for the form, without exposing anyone's data.
-- Returns 'email' or 'profile' when that email ID / profile link is already used, otherwise null.
drop function if exists public.is_registered(text, text);
create or replace function public.registration_conflict(p_email text, p_profile text)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when exists (select 1 from public.registrations
                 where lower(trim(email)) = lower(trim(coalesce(p_email, ''))) and coalesce(p_email, '') <> '')
      then 'email'
    when exists (select 1 from public.registrations
                 where lower(substring(profile_url from 'public_profiles/([A-Za-z0-9-]+)'))
                     = lower(substring(coalesce(p_profile, '') from 'public_profiles/([A-Za-z0-9-]+)')))
      then 'profile'
  end;
$$;
revoke execute on function public.registration_conflict(text, text) from public;
grant  execute on function public.registration_conflict(text, text) to anon, authenticated;

-- ---------- Screenshot storage (private bucket) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "students upload screenshots" on storage.objects;
drop policy if exists "admins read screenshots"     on storage.objects;
drop policy if exists "admins delete screenshots"   on storage.objects;
create policy "students upload screenshots" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'screenshots');
create policy "admins read screenshots" on storage.objects
  for select to authenticated using (bucket_id = 'screenshots' and public.is_admin());
create policy "admins delete screenshots" on storage.objects
  for delete to authenticated using (bucket_id = 'screenshots' and public.is_admin());

-- ---------- Your admin ----------
insert into public.admins (email)
values (lower('your-admin-email@example.com'))   -- <<< CHANGE THIS
on conflict do nothing;
