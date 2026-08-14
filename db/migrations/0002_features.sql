-- db/migrations/0002_features.sql
-- Activity types (work categories), global reminders, and backfill-window
-- modes for the native backend.

-- ---------------------------------------------------------------------------
-- activity_types: the selectable work categories on a time entry.
-- ---------------------------------------------------------------------------
create table public.activity_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.activity_types (name) values
  ('R&D'),
  ('Meeting'),
  ('Certification'),
  ('Presales support'),
  ('Documentation')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- timesheets: add an activity type reference. Nullable for legacy rows; the
-- application requires it for new/edited entries.
-- ---------------------------------------------------------------------------
alter table public.timesheets
  add column activity_type_id uuid references public.activity_types (id) on delete set null;

create index timesheets_activity_type_idx on public.timesheets (activity_type_id);

-- ---------------------------------------------------------------------------
-- Global reminders: admin-set, visible to all users; each user dismisses their
-- own copy (global_reminder_dismissals).
-- ---------------------------------------------------------------------------
create table public.global_reminders (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  remind_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.global_reminder_dismissals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  reminder_id uuid not null references public.global_reminders (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, reminder_id)
);

-- ---------------------------------------------------------------------------
-- Backfill window modes: 'days' (existing) or 'month_start' (window opens at
-- the 1st of the current month minus backfill_extra_days).
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column backfill_mode text not null default 'days'
    check (backfill_mode in ('days', 'month_start')),
  add column backfill_extra_days int not null default 0
    check (backfill_extra_days >= 0);
