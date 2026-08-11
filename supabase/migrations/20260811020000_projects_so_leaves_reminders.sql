-- S.O. numbers on projects, leave tracking, and personal reminders.

-- 1. Projects: S.O. number + management policies (rename / SO / delete)
alter table public.projects
  add column if not exists so_number text;

create policy "projects_update_manager" on public.projects
  for update to authenticated
  using (public.has_role('admin') or public.has_role('pm'))
  with check (public.has_role('admin') or public.has_role('pm'));

create policy "projects_delete_manager" on public.projects
  for delete to authenticated
  using (public.has_role('admin') or public.has_role('pm'));

-- 2. Leaves: one row per user per day
create table if not exists public.leaves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  leave_date date not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, leave_date)
);

create index if not exists leaves_user_date_idx on public.leaves (user_id, leave_date);

alter table public.leaves enable row level security;

create policy "leaves_select_own" on public.leaves
  for select to authenticated
  using (auth.uid() = user_id);

create policy "leaves_select_admin" on public.leaves
  for select to authenticated
  using (public.has_role('admin'));

create policy "leaves_insert_own" on public.leaves
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "leaves_insert_admin" on public.leaves
  for insert to authenticated
  with check (public.has_role('admin'));

create policy "leaves_update_own" on public.leaves
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "leaves_update_admin" on public.leaves
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

create policy "leaves_delete_own" on public.leaves
  for delete to authenticated
  using (auth.uid() = user_id);

create policy "leaves_delete_admin" on public.leaves
  for delete to authenticated
  using (public.has_role('admin'));

-- 3. Personal reminders
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null,
  remind_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists reminders_user_due_idx on public.reminders (user_id, remind_at);

alter table public.reminders enable row level security;

create policy "reminders_select_own" on public.reminders
  for select to authenticated
  using (auth.uid() = user_id);

create policy "reminders_insert_own" on public.reminders
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "reminders_update_own" on public.reminders
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "reminders_delete_own" on public.reminders
  for delete to authenticated
  using (auth.uid() = user_id);
