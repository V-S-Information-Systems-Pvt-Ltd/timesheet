-- db/migrations/0014_titles.sql
-- Manageable titles table seeded with standard organizational titles.

create table if not exists public.titles (
  id text primary key default gen_random_uuid()::text,
  name text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_titles_name on public.titles (name);

-- Seed initial standard titles
insert into public.titles (name) values
  ('Intern'),
  ('Associate Systems Engineer'),
  ('Systems Engineer'),
  ('Senior Systems Engineer'),
  ('Team Lead'),
  ('Manager')
on conflict (name) do nothing;
