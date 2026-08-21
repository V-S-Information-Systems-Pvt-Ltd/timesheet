-- ===========================================================================
-- VSIS Timesheet Demo Database Setup & Seed Script
-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard/project/jtvczqtjuzbemmjowmit/sql)
-- ===========================================================================

-- 1. Enable necessary extensions
create extension if not exists "pgcrypto";

-- 2. Core Tables (created first so triggers & policies can reference them safely)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text not null default '',
  department text not null default '',
  title text not null default '',
  role text not null default 'user' check (role in ('admin', 'pm', 'co', 'manager', 'team_lead', 'user')),
  is_active boolean not null default false,
  manager_id uuid references public.profiles(id) on delete set null,
  dashboard_layout jsonb,
  admin_layout jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  so_number text,
  telegram_no integer,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  telegram_no integer,
  created_at timestamptz not null default now()
);

create table if not exists public.timesheets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete restrict,
  activity_type_id uuid references public.activity_types (id) on delete set null,
  log_date date not null,
  hours_worked numeric(4, 2) not null check (hours_worked > 0 and hours_worked <= 24),
  work_done text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.leaves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  leave_date date not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique(user_id, leave_date)
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  remind_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.global_reminders (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  remind_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.global_reminder_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reminder_id uuid not null references public.global_reminders(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  unique(user_id, reminder_id)
);

create table if not exists public.app_settings (
  id integer primary key default 1 check (id = 1),
  backfill_window_days integer not null default 1 check (backfill_window_days >= 0),
  backfill_mode text not null default 'days' check (backfill_mode in ('days', 'month_start')),
  backfill_extra_days integer not null default 0 check (backfill_extra_days >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text not null,
  action text not null,
  target_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- 3. Indexes
create index if not exists timesheets_user_id_idx on public.timesheets (user_id);
create index if not exists timesheets_project_id_idx on public.timesheets (project_id);
create index if not exists timesheets_log_date_idx on public.timesheets (log_date desc);
create index if not exists timesheets_user_date_idx on public.timesheets (user_id, log_date desc);
create index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists idx_profiles_manager_id on public.profiles (manager_id);
create index if not exists idx_audit_logs_actor on public.audit_logs (actor_id);
create index if not exists idx_audit_logs_action on public.audit_logs (action);
create index if not exists idx_audit_logs_created on public.audit_logs (created_at desc);

-- 4. Helper Functions
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_admin_or_co()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'co')
  );
$$;

create or replace function public.is_pm_or_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'pm')
  );
$$;

create or replace function public.team_ids(lead_id uuid)
returns uuid[] language sql security definer set search_path = public stable as $$
  with recursive team as (
    select id from public.profiles where manager_id = lead_id
    union
    select p.id from public.profiles p
    inner join team t on p.manager_id = t.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) from team;
$$;

-- 24h Daily Hours Limit Trigger Function & Trigger
create or replace function public.check_daily_hours_limit()
returns trigger as $$
declare
  total numeric;
begin
  select coalesce(sum(hours_worked), 0) into total
  from public.timesheets
  where user_id = NEW.user_id
    and log_date = NEW.log_date
    and id is distinct from NEW.id;

  if total + NEW.hours_worked > 24 then
    raise exception 'Daily total would exceed 24 hours (%.2fh already logged on %)',
      total, NEW.log_date using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_check_daily_hours on public.timesheets;
create trigger trg_check_daily_hours
  before insert or update on public.timesheets
  for each row
  execute function public.check_daily_hours_limit();

-- Auth user sync trigger
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role, is_active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'user'),
    true
  )
  on conflict (id) do update
  set email = excluded.email,
      name = case when public.profiles.name = '' then excluded.name else public.profiles.name end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 5. Row Level Security
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.activity_types enable row level security;
alter table public.timesheets enable row level security;
alter table public.leaves enable row level security;
alter table public.reminders enable row level security;
alter table public.global_reminders enable row level security;
alter table public.global_reminder_dismissals enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_logs enable row level security;

-- Policies for profiles
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (
    auth.uid() = id
    or public.is_admin_or_co()
    or id = any(public.team_ids(auth.uid()))
  );

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update to authenticated
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin" on public.profiles for insert to authenticated
  with check (public.is_admin());

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin" on public.profiles for delete to authenticated
  using (public.is_admin());

-- Policies for projects
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects for select to authenticated using (true);

drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects for insert to authenticated with check (public.is_pm_or_admin());

drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects for update to authenticated using (public.is_pm_or_admin());

drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects for delete to authenticated using (public.is_pm_or_admin());

-- Policies for activity_types
drop policy if exists "activity_types_select" on public.activity_types;
create policy "activity_types_select" on public.activity_types for select to authenticated using (true);

drop policy if exists "activity_types_insert" on public.activity_types;
create policy "activity_types_insert" on public.activity_types for insert to authenticated with check (public.is_admin());

drop policy if exists "activity_types_update" on public.activity_types;
create policy "activity_types_update" on public.activity_types for update to authenticated using (public.is_admin());

drop policy if exists "activity_types_delete" on public.activity_types;
create policy "activity_types_delete" on public.activity_types for delete to authenticated using (public.is_admin());

-- Policies for timesheets
drop policy if exists "timesheets_select" on public.timesheets;
create policy "timesheets_select" on public.timesheets for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_admin_or_co()
    or user_id = any(public.team_ids(auth.uid()))
  );

drop policy if exists "timesheets_insert" on public.timesheets;
create policy "timesheets_insert" on public.timesheets for insert to authenticated
  with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "timesheets_update" on public.timesheets;
create policy "timesheets_update" on public.timesheets for update to authenticated
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "timesheets_delete" on public.timesheets;
create policy "timesheets_delete" on public.timesheets for delete to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- Policies for leaves
drop policy if exists "leaves_select" on public.leaves;
create policy "leaves_select" on public.leaves for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "leaves_insert" on public.leaves;
create policy "leaves_insert" on public.leaves for insert to authenticated
  with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "leaves_delete" on public.leaves;
create policy "leaves_delete" on public.leaves for delete to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- Policies for reminders
drop policy if exists "reminders_all" on public.reminders;
create policy "reminders_all" on public.reminders for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Policies for global reminders
drop policy if exists "global_reminders_select" on public.global_reminders;
create policy "global_reminders_select" on public.global_reminders for select to authenticated using (true);

drop policy if exists "global_reminders_manage" on public.global_reminders;
create policy "global_reminders_manage" on public.global_reminders for all to authenticated using (public.is_admin());

-- Policies for global reminder dismissals
drop policy if exists "dismissals_all" on public.global_reminder_dismissals;
create policy "dismissals_all" on public.global_reminder_dismissals for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Policies for app_settings
drop policy if exists "app_settings_select" on public.app_settings;
create policy "app_settings_select" on public.app_settings for select to authenticated using (true);

drop policy if exists "app_settings_update" on public.app_settings;
create policy "app_settings_update" on public.app_settings for update to authenticated using (public.is_admin());

-- Policies for audit_logs
drop policy if exists "audit_logs_select" on public.audit_logs;
create policy "audit_logs_select" on public.audit_logs for select using (public.is_admin());

drop policy if exists "audit_logs_insert" on public.audit_logs;
create policy "audit_logs_insert" on public.audit_logs for insert with check (auth.uid() is not null);

-- 6. Seed Initial App Settings, Activity Types, Projects, and Reminders
insert into public.app_settings (id, backfill_window_days, backfill_mode, backfill_extra_days)
values (1, 1, 'days', 0)
on conflict (id) do update set updated_at = now();

insert into public.activity_types (name, is_active, telegram_no) values
  ('R&D', true, 142),
  ('Meeting', true, 141),
  ('Certification', true, 112),
  ('Presales support', true, 120),
  ('Documentation', true, null),
  ('Delivery', true, null),
  ('Client Support', true, 115),
  ('Training', true, null)
on conflict (name) do nothing;

insert into public.projects (name, so_number, telegram_no) values
  ('Internal - General', null, 1000),
  ('025-DEC-2183 - RedHat Ansible Solution to Commercial Bank', 'SO-2026-001', 147),
  ('2023-MAY-0109-EC-UPGRADE-DIALOG', 'SO-2023-109', 104),
  ('2024-AUG-0736-ODA-OVM2KVM-PEOPLES-BANK', 'SO-2024-736', 110),
  ('2024-JUN-0384-HCP-SLT', 'SO-2024-384', 98),
  ('2024-NOV-1139-ORACLE-DB-FIRST-CAPITAL', 'SO-2024-1139', 108),
  ('2025-JAN-0042-OPENSHIFT-CLOUD-HNB', 'SO-2025-042', 155),
  ('2025-FEB-0088-KUBERNETES-MIGRATION-SAMPATH', 'SO-2025-088', 160)
on conflict (name) do nothing;

insert into public.global_reminders (message, remind_at) values
  ('Please ensure all weekly timesheets are submitted before Friday 5:00 PM.', now() + interval '1 day'),
  ('System maintenance scheduled for Sunday 2:00 AM - 4:00 AM UTC.', now() + interval '3 days')
on conflict do nothing;
