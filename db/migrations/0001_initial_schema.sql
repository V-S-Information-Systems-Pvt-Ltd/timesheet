-- db/migrations/0001_initial_schema.sql
-- Native (cloud-native) schema for the VSIS Time Sheet system.
--
-- This is the self-contained equivalent of the supabase/migrations/ schema,
-- minus Supabase-specific pieces (auth.users, auth.uid(), RLS policies, and
-- the handle_new_user trigger). Security is enforced in the application layer
-- (lib/db/repository.ts) instead of at the database via RLS.
--
-- Differences from the Supabase schema:
--   * profiles.password_hash stores the scrypt password hash for in-app auth.
--   * No auth schema / triggers / RLS policies.
--
-- Requires PostgreSQL 13+ (gen_random_uuid() is a core function there).

-- ---------------------------------------------------------------------------
-- profiles: one row per account. New accounts start inactive until an admin
-- activates them. role is constrained to the four application roles.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  department text not null default '',
  title text not null default '',
  role text not null default 'user' check (role in ('admin', 'pm', 'co', 'user')),
  is_active boolean not null default false,
  password_hash text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- projects: the project list used by the time log form and admin project
-- management. S.O. numbers are optional.
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  so_number text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- timesheets: hours logged per user, project, and date. One entry per user
-- per day is enforced by the unique index below (mirrors the Supabase
-- timesheets_one_entry_per_day migration).
-- ---------------------------------------------------------------------------
create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete restrict,
  log_date date not null,
  hours_worked numeric(4, 2) not null check (hours_worked > 0),
  work_done text not null,
  created_at timestamptz not null default now()
);

create index timesheets_user_id_idx on public.timesheets (user_id);
create index timesheets_log_date_idx on public.timesheets (log_date desc);
create unique index timesheets_user_date_key on public.timesheets (user_id, log_date);

-- ---------------------------------------------------------------------------
-- leaves: leave markers, one row per user per day.
-- ---------------------------------------------------------------------------
create table public.leaves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  leave_date date not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, leave_date)
);

create index leaves_user_date_idx on public.leaves (user_id, leave_date);

-- ---------------------------------------------------------------------------
-- reminders: personal reminders, one per user.
-- ---------------------------------------------------------------------------
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null,
  remind_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index reminders_user_due_idx on public.reminders (user_id, remind_at);

-- ---------------------------------------------------------------------------
-- app_settings: single-row app-wide settings.
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  backfill_window_days int not null default 1 check (backfill_window_days >= 0),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id, backfill_window_days)
values (1, 1)
on conflict (id) do nothing;
