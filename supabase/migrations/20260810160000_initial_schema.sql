-- supabase/migrations/20260810160000_initial_schema.sql
-- Initial schema, triggers, and Row Level Security policies for VSIS Time Sheet.
-- Matches the tables and RLS expectations used by app/types.ts and app/page.tsx.

-- ---------------------------------------------------------------------------
-- Helper: is the requesting user an admin?
-- SECURITY DEFINER so RLS policies can check admin status without recursing.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and is_admin
  );
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger on signup.
-- New accounts start inactive; an admin must activate them before they can
-- log time.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  is_admin boolean not null default false,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

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

-- ---------------------------------------------------------------------------
-- Auto-create a profile row when a new auth user signs up.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.timesheets enable row level security;

-- profiles: users see their own row; admins see everything.
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

create policy "profiles_select_admin" on public.profiles
  for select to authenticated
  using (public.is_admin());

-- Only admins can update profiles (whitelist / admin role toggles).
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- projects: any signed-in user can view; only admins can add.
create policy "projects_select_authenticated" on public.projects
  for select to authenticated
  using (true);

create policy "projects_insert_admin" on public.projects
  for insert to authenticated
  with check (public.is_admin());

-- timesheets: users manage their own rows; admins can view everything.
-- Inserts also require an active profile (pending accounts cannot log time).
create policy "timesheets_select_own" on public.timesheets
  for select to authenticated
  using (auth.uid() = user_id);

create policy "timesheets_select_admin" on public.timesheets
  for select to authenticated
  using (public.is_admin());

create policy "timesheets_insert_own_active" on public.timesheets
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_active
    )
  );
