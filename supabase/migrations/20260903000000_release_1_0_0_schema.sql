-- supabase/migrations/20260903000000_release_1_0_0_schema.sql
-- VSIS Time Sheet Supabase schema — consolidated release 1.0.0 baseline.
--
-- This file replaces the 30 versioned migrations (20260810160000 … 
-- 20260902010000) with a single baseline for fresh installs. Every statement
-- is idempotent (IF NOT EXISTS / drop-then-add / create or replace) so the
-- file can safely no-op on databases that already applied the old per-feature
-- history.
--
-- Apply via the Supabase CLI: `npx supabase db reset` (fresh) or
-- `npx supabase db push` (existing).

-- ---------------------------------------------------------------------------
-- Helper: does the requesting user hold the given role?
-- SECURITY DEFINER so RLS policies can check roles without recursing.
-- Honours both the permission_role and hierarchy_role axes.
-- ---------------------------------------------------------------------------
create or replace function public.has_role(role_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (p.permission_role = role_name or p.hierarchy_role = role_name)
  );
$$;

grant execute on function public.has_role(text) to authenticated;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger on signup.
-- New accounts start inactive; an admin must activate them before they can
-- log time.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text not null default '',
  department text not null default '',
  title text not null default '',
  role text not null default 'user',
  is_active boolean not null default false,
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

-- Backfill email from auth.users for any legacy rows missing it.
update public.profiles p
set email = coalesce(u.email, 'orphan-' || p.id || '@invalid.local')
from auth.users u
where u.id = p.id;

update public.profiles
set email = 'orphan-' || id || '@invalid.local'
where email is null;

-- Set NOT NULL / UNIQUE only if not already present (existing hosted
-- databases may already carry them).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'email' and is_nullable = 'YES'
  ) then
    alter table public.profiles alter column email set not null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'u' and conname = 'profiles_email_key'
  ) then
    alter table public.profiles add constraint profiles_email_key unique (email);
  end if;
end
$$;

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
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  auto_activate boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_whitelisted_domains_domain on public.whitelisted_domains (domain);

-- ---------------------------------------------------------------------------
-- titles: manageable titles table seeded with standard organizational titles.
-- ---------------------------------------------------------------------------
create table if not exists public.titles (
  id uuid primary key default gen_random_uuid(),
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
-- Auto-create a profile row when a new auth user signs up. The trigger
-- respects the domain whitelist: registrations from non-whitelisted domains
-- are rejected, and whitelisted auto_activate domains create active profiles.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_domain text;
  domain_auto boolean;
  domain_found boolean := false;
begin
  user_domain := lower(split_part(new.email, '@', 2));
  select auto_activate into domain_auto
  from public.whitelisted_domains
  where lower(domain) = user_domain
  limit 1;

  if found then
    domain_found := true;
  end if;

  if not domain_found then
    raise exception 'Registration is not allowed for @% domain. Contact an administrator.', user_domain;
  end if;

  insert into public.profiles (id, email, name, is_active)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), ''),
    coalesce(domain_auto, false)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Role helper: direct + indirect reports of `target` (does not include target
-- themselves). SECURITY DEFINER reads profiles without RLS recursion; UNION
-- (not UNION ALL) on the recursive branch so traversal terminates even if
-- manager_id data contains a cycle.
-- ---------------------------------------------------------------------------
create or replace function public.team_ids(target uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive team as (
    select id from public.profiles where manager_id = target
    union
    select p.id from public.profiles p join team t on p.manager_id = t.id
  )
  select array(select id from team)
$$;

grant execute on function public.team_ids(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reporting / import RPCs
-- ---------------------------------------------------------------------------

-- Grouped daily totals for imports. SECURITY DEFINER + service_role only:
-- it returns EVERY user's hours, so it must never be callable by clients.
-- (Phase 4.3 remediation — do not re-grant to authenticated.)
create or replace function public.get_timesheet_daily_totals()
returns table (
  user_id uuid,
  log_date date,
  hours numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select user_id, log_date, coalesce(sum(hours_worked), 0) as hours
  from public.timesheets
  group by user_id, log_date;
$$;

revoke all on function public.get_timesheet_daily_totals() from public, anon, authenticated;
grant execute on function public.get_timesheet_daily_totals() to service_role;

-- Server-side GROUP BY aggregation for reports. SECURITY INVOKER so RLS on
-- public.timesheets scopes the rows exactly as the normal read path does.
create or replace function public.get_grouped_report_totals(
  p_group_by text,
  p_project_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  label text,
  hours double precision,
  entries bigint
)
language sql
stable
parallel safe
set search_path = public
as $$
  select
    case
      when p_group_by = 'project' then coalesce(p.name, 'Unknown project')
      when p_group_by = 'activity' then coalesce(at.name, '(no type)')
      else coalesce(pr.email, 'Unknown')
    end as label,
    coalesce(sum(t.hours_worked), 0) as hours,
    count(*) as entries
  from public.timesheets t
  left join public.projects p on p.id = t.project_id
  left join public.activity_types at on at.id = t.activity_type_id
  left join public.profiles pr on pr.id = t.user_id
  where (p_project_id is null or t.project_id = p_project_id)
    and (p_from is null or t.log_date >= p_from)
    and (p_to is null or t.log_date <= p_to)
  group by label
  order by hours desc;
$$;

revoke all on function public.get_grouped_report_totals(text, uuid, date, date) from public, anon;
grant execute on function public.get_grouped_report_totals(text, uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Self-service profile editing lock: users may update their own department/
-- title, but name/email/role/is_active/role-axes stay admin-controlled.
-- ---------------------------------------------------------------------------
create or replace function public.my_locked_profile_fields()
returns table (
  name text,
  email text,
  role text,
  permission_role text,
  hierarchy_role text,
  is_active boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select name, email, role, permission_role, hierarchy_role, is_active
  from public.profiles
  where id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Keep the legacy `role` derivable from the two independent axes on every
-- write.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Concurrency-safe daily hours enforcement (24h cap per user per day).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.timesheets enable row level security;
alter table public.leaves enable row level security;
alter table public.reminders enable row level security;
alter table public.app_settings enable row level security;
alter table public.activity_types enable row level security;
alter table public.global_reminders enable row level security;
alter table public.global_reminder_dismissals enable row level security;
alter table public.audit_logs enable row level security;
alter table public.whitelisted_domains enable row level security;
alter table public.titles enable row level security;

-- Profiles: users see their own row; management (admin/co) and team leads see
-- more. Only admins can update profiles.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_select_management" on public.profiles;
create policy "profiles_select_management" on public.profiles
  for select to authenticated
  using (public.has_role('admin') or public.has_role('co'));

drop policy if exists "profiles_select_team" on public.profiles;
create policy "profiles_select_team" on public.profiles
  for select to authenticated
  using (
    (public.has_role('manager') or public.has_role('team_lead'))
    and id = any(public.team_ids(auth.uid()))
  );

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

drop policy if exists "profiles_update_own_details" on public.profiles;
create policy "profiles_update_own_details" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and name = (select name from public.my_locked_profile_fields())
    and email = (select email from public.my_locked_profile_fields())
    and role = (select role from public.my_locked_profile_fields())
    and permission_role = (select permission_role from public.my_locked_profile_fields())
    and hierarchy_role = (select hierarchy_role from public.my_locked_profile_fields())
    and is_active = (select is_active from public.my_locked_profile_fields())
  );

-- Projects: any signed-in user can view; admins and PMs manage.
drop policy if exists "projects_select_authenticated" on public.projects;
create policy "projects_select_authenticated" on public.projects
  for select to authenticated
  using (true);

drop policy if exists "projects_insert_manager" on public.projects;
create policy "projects_insert_manager" on public.projects
  for insert to authenticated
  with check (public.has_role('admin') or public.has_role('pm'));

drop policy if exists "projects_update_manager" on public.projects;
create policy "projects_update_manager" on public.projects
  for update to authenticated
  using (public.has_role('admin') or public.has_role('pm'))
  with check (public.has_role('admin') or public.has_role('pm'));

drop policy if exists "projects_delete_manager" on public.projects;
create policy "projects_delete_manager" on public.projects
  for delete to authenticated
  using (public.has_role('admin') or public.has_role('pm'));

-- Timesheets: users manage their own rows; management and team leads can view
-- more. Inserts also require an active profile.
drop policy if exists "timesheets_select_own" on public.timesheets;
create policy "timesheets_select_own" on public.timesheets
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "timesheets_select_management" on public.timesheets;
create policy "timesheets_select_management" on public.timesheets
  for select to authenticated
  using (public.has_role('admin') or public.has_role('co'));

drop policy if exists "timesheets_select_team" on public.timesheets;
create policy "timesheets_select_team" on public.timesheets
  for select to authenticated
  using (
    (public.has_role('manager') or public.has_role('team_lead'))
    and user_id = any(public.team_ids(auth.uid()))
  );

drop policy if exists "timesheets_insert_own_active" on public.timesheets;
create policy "timesheets_insert_own_active" on public.timesheets
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_active
    )
  );

drop policy if exists "timesheets_insert_admin" on public.timesheets;
create policy "timesheets_insert_admin" on public.timesheets
  for insert to authenticated
  with check (public.has_role('admin'));

drop policy if exists "timesheets_update_own" on public.timesheets;
create policy "timesheets_update_own" on public.timesheets
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "timesheets_update_admin" on public.timesheets;
create policy "timesheets_update_admin" on public.timesheets
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

drop policy if exists "timesheets_delete_own" on public.timesheets;
create policy "timesheets_delete_own" on public.timesheets
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "timesheets_delete_admin" on public.timesheets;
create policy "timesheets_delete_admin" on public.timesheets
  for delete to authenticated
  using (public.has_role('admin'));

-- Leaves: users manage their own rows; admins manage all.
drop policy if exists "leaves_select_own" on public.leaves;
create policy "leaves_select_own" on public.leaves
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "leaves_select_admin" on public.leaves;
create policy "leaves_select_admin" on public.leaves
  for select to authenticated
  using (public.has_role('admin'));

drop policy if exists "leaves_insert_own" on public.leaves;
create policy "leaves_insert_own" on public.leaves
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "leaves_insert_admin" on public.leaves;
create policy "leaves_insert_admin" on public.leaves
  for insert to authenticated
  with check (public.has_role('admin'));

drop policy if exists "leaves_update_own" on public.leaves;
create policy "leaves_update_own" on public.leaves
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "leaves_update_admin" on public.leaves;
create policy "leaves_update_admin" on public.leaves
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

drop policy if exists "leaves_delete_own" on public.leaves;
create policy "leaves_delete_own" on public.leaves
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "leaves_delete_admin" on public.leaves;
create policy "leaves_delete_admin" on public.leaves
  for delete to authenticated
  using (public.has_role('admin'));

-- Reminders: users manage their own rows.
drop policy if exists "reminders_select_own" on public.reminders;
create policy "reminders_select_own" on public.reminders
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "reminders_insert_own" on public.reminders;
create policy "reminders_insert_own" on public.reminders
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "reminders_update_own" on public.reminders;
create policy "reminders_update_own" on public.reminders
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "reminders_delete_own" on public.reminders;
create policy "reminders_delete_own" on public.reminders
  for delete to authenticated
  using (auth.uid() = user_id);

-- App settings: every signed-in user may read; only admins may update.
drop policy if exists "app_settings_select_authenticated" on public.app_settings;
create policy "app_settings_select_authenticated" on public.app_settings
  for select to authenticated
  using (true);

drop policy if exists "app_settings_update_admin" on public.app_settings;
create policy "app_settings_update_admin" on public.app_settings
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

grant select on public.app_settings to authenticated;

-- Activity types: selectable by all; managed by admins.
drop policy if exists "activity_types_select" on public.activity_types;
create policy "activity_types_select" on public.activity_types
  for select to authenticated using (true);

drop policy if exists "activity_types_insert_admin" on public.activity_types;
create policy "activity_types_insert_admin" on public.activity_types
  for insert to authenticated with check (public.has_role('admin'));

drop policy if exists "activity_types_update_admin" on public.activity_types;
create policy "activity_types_update_admin" on public.activity_types
  for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

-- Global reminders + dismissals.
drop policy if exists "global_reminders_select" on public.global_reminders;
create policy "global_reminders_select" on public.global_reminders
  for select to authenticated using (true);

drop policy if exists "global_reminders_insert_admin" on public.global_reminders;
create policy "global_reminders_insert_admin" on public.global_reminders
  for insert to authenticated with check (public.has_role('admin'));

drop policy if exists "global_reminders_delete_admin" on public.global_reminders;
create policy "global_reminders_delete_admin" on public.global_reminders
  for delete to authenticated using (public.has_role('admin'));

drop policy if exists "dismissals_select_own" on public.global_reminder_dismissals;
create policy "dismissals_select_own" on public.global_reminder_dismissals
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "dismissals_insert_own" on public.global_reminder_dismissals;
create policy "dismissals_insert_own" on public.global_reminder_dismissals
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "dismissals_delete_own" on public.global_reminder_dismissals;
create policy "dismissals_delete_own" on public.global_reminder_dismissals
  for delete to authenticated using (auth.uid() = user_id);

-- Audit logs: admins can view; writes must identify the authenticated actor.
drop policy if exists "Admins can view audit logs" on public.audit_logs;
create policy "Admins can view audit logs"
  on public.audit_logs for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists "Admins can insert own audit logs" on public.audit_logs;
create policy "Admins can insert own audit logs"
  on public.audit_logs for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
    and actor_id = auth.uid()
    and actor_email = (
      select email from public.profiles where id = auth.uid()
    )
  );

-- Whitelisted domains: selectable by all; managed by admins.
drop policy if exists "whitelisted_domains_select_authenticated" on public.whitelisted_domains;
create policy "whitelisted_domains_select_authenticated" on public.whitelisted_domains
  for select to authenticated
  using (true);

drop policy if exists "whitelisted_domains_admin_all" on public.whitelisted_domains;
create policy "whitelisted_domains_admin_all" on public.whitelisted_domains
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- Titles: selectable by all; managed by admins.
drop policy if exists "titles_select_authenticated" on public.titles;
create policy "titles_select_authenticated" on public.titles
  for select to authenticated
  using (true);

drop policy if exists "titles_admin_all" on public.titles;
create policy "titles_admin_all" on public.titles
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

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

-- Seed activity-type fallbacks.
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
