-- supabase/migrations/20260815000000_features.sql
-- Activity types, global reminders, backfill-window modes, and self-service
-- profile editing (users edit department/title; only admins edit name).

-- ---------------------------------------------------------------------------
-- activity_types
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

alter table public.timesheets
  add column activity_type_id uuid references public.activity_types (id) on delete set null;

create index timesheets_activity_type_idx on public.timesheets (activity_type_id);

alter table public.activity_types enable row level security;

create policy "activity_types_select" on public.activity_types
  for select to authenticated using (true);

create policy "activity_types_insert_admin" on public.activity_types
  for insert to authenticated with check (public.has_role('admin'));

create policy "activity_types_update_admin" on public.activity_types
  for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

-- ---------------------------------------------------------------------------
-- global_reminders + per-user dismissals
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

alter table public.global_reminders enable row level security;
alter table public.global_reminder_dismissals enable row level security;

create policy "global_reminders_select" on public.global_reminders
  for select to authenticated using (true);

create policy "global_reminders_insert_admin" on public.global_reminders
  for insert to authenticated with check (public.has_role('admin'));

create policy "global_reminders_delete_admin" on public.global_reminders
  for delete to authenticated using (public.has_role('admin'));

create policy "dismissals_select_own" on public.global_reminder_dismissals
  for select to authenticated using (auth.uid() = user_id);

create policy "dismissals_insert_own" on public.global_reminder_dismissals
  for insert to authenticated with check (auth.uid() = user_id);

create policy "dismissals_delete_own" on public.global_reminder_dismissals
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Backfill window modes
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column backfill_mode text not null default 'days'
    check (backfill_mode in ('days', 'month_start')),
  add column backfill_extra_days int not null default 0
    check (backfill_extra_days >= 0);

-- ---------------------------------------------------------------------------
-- Self-service profile editing: users may update their own department/title,
-- but name/email/role/is_active stay admin-controlled.
-- ---------------------------------------------------------------------------
create or replace function public.my_locked_profile_fields()
returns table (name text, email text, role text, is_active boolean)
language sql
security definer
set search_path = public
stable
as $$
  select name, email, role, is_active
  from public.profiles
  where id = auth.uid()
$$;

create policy "profiles_update_own_details" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and name = (select name from public.my_locked_profile_fields())
    and email = (select email from public.my_locked_profile_fields())
    and role = (select role from public.my_locked_profile_fields())
    and is_active = (select is_active from public.my_locked_profile_fields())
  );
