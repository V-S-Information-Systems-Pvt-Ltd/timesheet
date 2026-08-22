-- supabase/migrations/20260826000000_titles.sql
-- Manageable titles table with RLS and initial standard titles.

create table if not exists public.titles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_titles_name on public.titles (name);

alter table public.titles enable row level security;

create policy "titles_select_authenticated" on public.titles
  for select to authenticated
  using (true);

create policy "titles_admin_all" on public.titles
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- Seed initial standard titles
insert into public.titles (name) values
  ('Intern'),
  ('Associate Systems Engineer'),
  ('Systems Engineer'),
  ('Senior Systems Engineer'),
  ('Team Lead'),
  ('Manager')
on conflict (name) do nothing;
