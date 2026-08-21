-- 20260826000000_separate_roles.sql
-- Separate the legacy single `role` column into two INDEPENDENT axes:
--   * permission_role  — authorization (admin | pm | co | user)
--   * hierarchy_role   — reporting position (manager | team_lead | user)
--
-- Mirrors db/migrations/0009_separate_roles.sql. The `role` column is kept
-- for the transition and kept in sync by a trigger.

alter table public.profiles
  add column if not exists permission_role text not null default 'user',
  add column if not exists hierarchy_role text not null default 'user';

update public.profiles
set permission_role = case when role in ('admin', 'pm', 'co') then role else 'user' end,
    hierarchy_role  = case when role in ('manager', 'team_lead') then role else 'user' end
where 1 = 1;

alter table public.profiles drop constraint if exists profiles_permission_role_check;
alter table public.profiles
  add constraint profiles_permission_role_check check (permission_role in ('admin', 'pm', 'co', 'user'));

alter table public.profiles drop constraint if exists profiles_hierarchy_role_check;
alter table public.profiles
  add constraint profiles_hierarchy_role_check check (hierarchy_role in ('manager', 'team_lead', 'user'));

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
