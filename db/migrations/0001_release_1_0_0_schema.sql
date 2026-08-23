-- db/migrations/0001_release_1_0_0_schema.sql
-- VSIS Time Sheet native backend schema — consolidated release 1.0.0 baseline.
--
-- This file replaces the 15 versioned migrations (0001_initial_schema …
-- 0015_data_integrity_and_concurrency) with a single baseline for fresh
-- installs. Every statement is idempotent (IF NOT EXISTS / drop-then-add /
-- create or replace) so the file can safely no-op on databases that already
-- applied the old per-feature history.
--
-- The native backend enforces security in the application layer
-- (lib/db/repository.ts) instead of RLS; there is no auth schema.

-- ---------------------------------------------------------------------------
-- profiles: one row per account. New accounts start inactive until an admin
-- activates them. role is the legacy single column; permission_role /
-- hierarchy_role are the two independent axes kept in sync by a trigger.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  department text not null default '',
  title text not null default '',
  role text not null default 'user',
  is_active boolean not null default false,
  password_hash text,
  created_at timestamptz not null default now(),
  manager_id uuid references public.profiles (id) on delete set null,
  dashboard_layout jsonb,
  admin_layout jsonb,
  permission_role text not null default 'user',
  hierarchy_role text not null default 'user'
);

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'pm', 'co', 'manager', 'team_lead', 'user'));

alter table public.profiles drop constraint if exists profiles_permission_role_check;
alter table public.profiles
  add constraint profiles_permission_role_check check (permission_role in ('admin', 'pm', 'co', 'user'));

alter table public.profiles drop constraint if exists profiles_hierarchy_role_check;
alter table public.profiles
  add constraint profiles_hierarchy_role_check check (hierarchy_role in ('manager', 'team_lead', 'user'));

create index if not exists profiles_manager_id_idx on public.profiles (manager_id);

-- ---------------------------------------------------------------------------
-- activity_types: the selectable work categories on a time entry.
-- ---------------------------------------------------------------------------
create table if not exists public.activity_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  telegram_no int,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists activity_types_telegram_no_key
  on public.activity_types (telegram_no) where telegram_no is not null;

insert into public.activity_types (name) values
  ('R&D'),
  ('Meeting'),
  ('Certification'),
  ('Presales support'),
  ('Documentation')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- projects: the project list used by the time log form and admin project
-- management. S.O. numbers and Telegram bot numbers are optional.
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  so_number text,
  telegram_no int,
  created_at timestamptz not null default now()
);

create unique index if not exists projects_telegram_no_key
  on public.projects (telegram_no) where telegram_no is not null;

-- ---------------------------------------------------------------------------
-- timesheets: hours logged per user, project, and date. Multiple entries per
-- user per day are allowed (the daily 24h cap is enforced by a trigger below).
-- ---------------------------------------------------------------------------
create table if not exists public.timesheets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete restrict,
  log_date date not null,
  hours_worked numeric(4, 2) not null,
  work_done text not null,
  activity_type_id uuid references public.activity_types (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.timesheets drop constraint if exists timesheets_hours_worked_check;
alter table public.timesheets
  add constraint timesheets_hours_worked_check check (hours_worked > 0 and hours_worked <= 24);

create index if not exists timesheets_user_id_idx on public.timesheets (user_id);
create index if not exists timesheets_log_date_idx on public.timesheets (log_date desc);
create index if not exists idx_timesheets_user_date on public.timesheets (user_id, log_date desc);
create index if not exists timesheets_activity_type_idx on public.timesheets (activity_type_id);

-- ---------------------------------------------------------------------------
-- leaves: leave markers, one row per user per day.
-- ---------------------------------------------------------------------------
create table if not exists public.leaves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  leave_date date not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, leave_date)
);

create index if not exists leaves_user_date_idx on public.leaves (user_id, leave_date);

-- ---------------------------------------------------------------------------
-- reminders: personal reminders, one per user.
-- ---------------------------------------------------------------------------
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null,
  remind_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists reminders_user_due_idx on public.reminders (user_id, remind_at);

-- ---------------------------------------------------------------------------
-- app_settings: single-row app-wide settings.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  backfill_window_days int not null default 1 check (backfill_window_days >= 0),
  backfill_mode text not null default 'days',
  backfill_extra_days int not null default 0,
  default_dashboard_layout jsonb,
  default_admin_layout jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_settings drop constraint if exists app_settings_backfill_mode_check;
alter table public.app_settings
  add constraint app_settings_backfill_mode_check check (backfill_mode in ('days', 'month_start'));

alter table public.app_settings drop constraint if exists app_settings_backfill_extra_days_check;
alter table public.app_settings
  add constraint app_settings_backfill_extra_days_check check (backfill_extra_days >= 0);

insert into public.app_settings (id, backfill_window_days)
values (1, 1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- global_reminders + per-user dismissals
-- ---------------------------------------------------------------------------
create table if not exists public.global_reminders (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  remind_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.global_reminder_dismissals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  reminder_id uuid not null references public.global_reminders (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, reminder_id)
);

-- ---------------------------------------------------------------------------
-- audit_logs: immutable audit log for administrative operations.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text not null,
  action text not null,
  target_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_actor on public.audit_logs (actor_id);
create index if not exists idx_audit_logs_action on public.audit_logs (action);
create index if not exists idx_audit_logs_created on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- whitelisted_domains: email domain whitelist for self-registration.
-- ---------------------------------------------------------------------------
create table if not exists public.whitelisted_domains (
  id text primary key default gen_random_uuid()::text,
  domain text not null unique,
  auto_activate boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_whitelisted_domains_domain on public.whitelisted_domains (domain);

-- ---------------------------------------------------------------------------
-- titles: manageable titles table seeded with standard organizational titles.
-- ---------------------------------------------------------------------------
create table if not exists public.titles (
  id text primary key default gen_random_uuid()::text,
  name text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_titles_name on public.titles (name);

insert into public.titles (name) values
  ('Intern'),
  ('Associate Systems Engineer'),
  ('Systems Engineer'),
  ('Senior Systems Engineer'),
  ('Team Lead'),
  ('Manager')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Role helpers / triggers
-- ---------------------------------------------------------------------------

-- Keep the legacy `role` derivable from the two independent axes on every write.
create or replace function public.sync_legacy_role()
returns trigger as $$
begin
  new.role := case
    when new.permission_role = 'admin' then 'admin'
    when new.permission_role = 'pm' then 'pm'
    when new.permission_role = 'co' then 'co'
    else new.hierarchy_role
  end;
  return new;
end $$ language plpgsql;

drop trigger if exists trg_profiles_sync_legacy_role on public.profiles;
create trigger trg_profiles_sync_legacy_role
  before insert or update of permission_role, hierarchy_role
  on public.profiles
  for each row execute function public.sync_legacy_role();

-- Backfill the two axes from the legacy role (kept idempotent).
update public.profiles
set permission_role = case when role in ('admin', 'pm', 'co') then role else 'user' end,
    hierarchy_role  = case when role in ('manager', 'team_lead') then role else 'user' end
where 1 = 1;

-- Concurrency-safe daily hours enforcement (24h cap per user per day).
create or replace function public.check_daily_hours_limit()
returns trigger as $$
declare
  total numeric;
begin
  -- Transaction-scoped advisory lock derived from user and date to serialize concurrent writes
  perform pg_advisory_xact_lock(hashtext(NEW.user_id::text || ':' || NEW.log_date::text));

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

-- Direct + indirect reports of `target` (does not include target themselves).
create or replace function public.team_ids(target uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive team as (
    select id from public.profiles where manager_id = target
    union all
    select p.id from public.profiles p join team t on p.manager_id = t.id
  )
  select array(select id from team)
$$;

grant execute on function public.team_ids(uuid) to public;

-- ---------------------------------------------------------------------------
-- Telegram project numbers: ensure the Telegram bot's projects exist so the
-- panel can generate commands. Idempotent: rows whose name already exists
-- are left untouched; numbers are only filled when missing.
-- ---------------------------------------------------------------------------
insert into public.projects (name, telegram_no)
select v.name, v.telegram_no
from (values
  ('025-DEC-2183 - RedHat Ansible Solution to Commercial Bank', 147),
  ('2023-MAY-0109-EC-UPGRADE-DIALOG', 104),
  ('2024-AUG-0736-ODA-OVM2KVM-PEOPLES-BANK', 110),
  ('2024-JUN-0384-HCP-SLT', 98),
  ('2024-NOV-1139-ORACLE-DB-FIRST-CAPITAL', 108),
  ('2024-SEP-0804-DARKTRACE-BOC', 99),
  ('2024-SEP-0846-DC-VIRTUALIZATION-LAUGFS', 100),
  ('2025-AUG-1051-COMMVAULT-INFRA-REVAMP-LB_FINANCE', 138),
  ('2025-AUG-1098 - Firewalla and Switch Replacement - LFSBL', 145),
  ('2025-Dec-2120-ALLIANZ-INSURENCE-CITRIX-IMPLEMENTATION', 137),
  ('2025-Dec-2183', 191),
  ('2025-DEC-2201-DR-DMZ-Cluster-Alignment-Project-CEB', 151),
  ('2025-DEC-2243-CARGILLS-BANK-UPGRADE', 170),
  ('2025-JAN-1631-CEB-DC-IMPLEMENTATION', 136),
  ('2025-JUL-0722-HYPERV2AZURE-A&E', 111),
  ('2025-JUN-0462-BACKUP-IMPLEMENTATION-SILVERMILLS', 102),
  ('2025-MAR-2002-MANAGE-ENGINE-DIMO', 105),
  ('2025-MAY-0291-BMC-HELIX-SAMPATH-BANK', 101),
  ('2025-May-0298 BoC Finacal', 166),
  ('2025-MAY-0383-OCEAN-DORADO-UNDP-CIABOC', 106),
  ('2025-MAY-0551-OCEAN-PROTECT-UNDP-CIABOC', 107),
  ('2025-NOV-2006-NARA-IMPLEMENTATION', 127),
  ('2025-NOV-2029 AD & File server deployment Opex Agrin', 169),
  ('2025-OCT-1581-ORACLE-AUDIT-FIRST-CAPITAL', 109),
  ('2025-OCT-1687-DC-VIRTUALIZATION-SIMPLIVITY-DLB', 125),
  ('2025-OCT-1801-SLIIT RedHat OpenShift-SLIIT', 143),
  ('2025-OCT-1835-METACNO-HARDWARE-IMPLEMENTATION', 128),
  ('2025-SEP-1295-VEEM-BACKUP-CEB', 103),
  ('2025-SEP-1377-MANAGE-ENGINE-SLIC', 126),
  ('Abans Backup Solution', 225),
  ('Amana Bank PCA Deployment', 223),
  ('Certifications', 112),
  ('Commercial Bank Citrix Deployment 2026-Mar-2870', 190),
  ('DIMO Mange engine', 230),
  ('Isabella_win_server_Sql licence implementation', 222),
  ('LB Finace Synergy 480 Gen12', 228),
  ('Meetings', 141),
  ('NTB Huawei OceanProtect & Commvault Capacity Upgrade | 2026-MAR-3076', 226),
  ('POC', 129),
  ('Pulse', 144),
  ('R&D', 142),
  ('SLSI LIMS Project', 231),
  ('Support', 94),
  ('TATA Lanka Server Project', 224)
) as v(name, telegram_no)
where not exists (select 1 from public.projects p where p.name = v.name);

-- Fill numbers for rows that already existed before this migration ran.
update public.projects set telegram_no = v.no
from (values
  ('025-DEC-2183 - RedHat Ansible Solution to Commercial Bank', 147),
  ('2023-MAY-0109-EC-UPGRADE-DIALOG', 104),
  ('2024-AUG-0736-ODA-OVM2KVM-PEOPLES-BANK', 110),
  ('2024-JUN-0384-HCP-SLT', 98),
  ('2024-NOV-1139-ORACLE-DB-FIRST-CAPITAL', 108),
  ('2024-SEP-0804-DARKTRACE-BOC', 99),
  ('2024-SEP-0846-DC-VIRTUALIZATION-LAUGFS', 100),
  ('2025-AUG-1051-COMMVAULT-INFRA-REVAMP-LB_FINANCE', 138),
  ('2025-AUG-1098 - Firewalla and Switch Replacement - LFSBL', 145),
  ('2025-Dec-2120-ALLIANZ-INSURENCE-CITRIX-IMPLEMENTATION', 137),
  ('2025-Dec-2183', 191),
  ('2025-DEC-2201-DR-DMZ-Cluster-Alignment-Project-CEB', 151),
  ('2025-DEC-2243-CARGILLS-BANK-UPGRADE', 170),
  ('2025-JAN-1631-CEB-DC-IMPLEMENTATION', 136),
  ('2025-JUL-0722-HYPERV2AZURE-A&E', 111),
  ('2025-JUN-0462-BACKUP-IMPLEMENTATION-SILVERMILLS', 102),
  ('2025-MAR-2002-MANAGE-ENGINE-DIMO', 105),
  ('2025-MAY-0291-BMC-HELIX-SAMPATH-BANK', 101),
  ('2025-May-0298 BoC Finacal', 166),
  ('2025-MAY-0383-OCEAN-DORADO-UNDP-CIABOC', 106),
  ('2025-MAY-0551-OCEAN-PROTECT-UNDP-CIABOC', 107),
  ('2025-NOV-2006-NARA-IMPLEMENTATION', 127),
  ('2025-NOV-2029 AD & File server deployment Opex Agrin', 169),
  ('2025-OCT-1581-ORACLE-AUDIT-FIRST-CAPITAL', 109),
  ('2025-OCT-1687-DC-VIRTUALIZATION-SIMPLIVITY-DLB', 125),
  ('2025-OCT-1801-SLIIT RedHat OpenShift-SLIIT', 143),
  ('2025-OCT-1835-METACNO-HARDWARE-IMPLEMENTATION', 128),
  ('2025-SEP-1295-VEEM-BACKUP-CEB', 103),
  ('2025-SEP-1377-MANAGE-ENGINE-SLIC', 126),
  ('Abans Backup Solution', 225),
  ('Amana Bank PCA Deployment', 223),
  ('Certifications', 112),
  ('Commercial Bank Citrix Deployment 2026-Mar-2870', 190),
  ('DIMO Mange engine', 230),
  ('Isabella_win_server_Sql licence implementation', 222),
  ('LB Finace Synergy 480 Gen12', 228),
  ('Meetings', 141),
  ('NTB Huawei OceanProtect & Commvault Capacity Upgrade | 2026-MAR-3076', 226),
  ('POC', 129),
  ('Pulse', 144),
  ('R&D', 142),
  ('SLSI LIMS Project', 231),
  ('Support', 94),
  ('TATA Lanka Server Project', 224)
) as v(name, no)
where public.projects.name = v.name
  and public.projects.telegram_no is null;

-- Seed activity-type fallbacks so entries logged against a pseudo-project
-- (like Support or R&D) still produce a working command.
update public.activity_types set telegram_no = v.no
from (values
  ('R&D', 142),
  ('Meeting', 141),
  ('Certification', 112),
  ('Presales support', 94)
) as v(name, no)
where public.activity_types.name = v.name
  and public.activity_types.telegram_no is null;

-- Default project for the Log Time form; the Telegram command builder treats
-- entries against it specially (prefers the activity type's bot number).
insert into public.projects (name, telegram_no)
select v.name, v.telegram_no
from (values ('Internal', 1000)) as v(name, telegram_no)
where not exists (select 1 from public.projects p where p.name = v.name);
