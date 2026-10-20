-- Department list and the admin/CO department boundary.
-- profiles.department stays free text for compatibility; the application only
-- accepts names on this list. Renames cascade to profiles in the same transaction.
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100 and name = btrim(name)),
  created_at timestamptz not null default now()
);
create unique index if not exists departments_name_key on public.departments (name);

update public.profiles set department = btrim(department) where department <> btrim(department);

insert into public.departments (name)
select distinct btrim(department) from public.profiles where btrim(department) <> ''
on conflict do nothing;

-- Null or empty: unrestricted. Only read for admin and CO accounts.
alter table public.profiles add column if not exists scope_departments text[];
