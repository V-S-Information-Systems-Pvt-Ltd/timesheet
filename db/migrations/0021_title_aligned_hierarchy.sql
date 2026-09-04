-- db/migrations/0021_title_aligned_hierarchy.sql
-- Add title hierarchy classification and engineer hierarchy role

-- 1. Widen profiles hierarchy_role check to allow 'engineer'
alter table public.profiles drop constraint if exists profiles_hierarchy_role_check;
alter table public.profiles
  add constraint profiles_hierarchy_role_check check (hierarchy_role in ('manager', 'team_lead', 'engineer', 'user'));

-- 2. Update sync_legacy_role trigger function to map engineer to 'user'
create or replace function public.sync_legacy_role()
returns trigger as $$
begin
  new.role := case
    when new.permission_role = 'admin' then 'admin'
    when new.permission_role = 'pm' then 'pm'
    when new.permission_role = 'co' then 'co'
    when new.hierarchy_role = 'manager' then 'manager'
    when new.hierarchy_role = 'team_lead' then 'team_lead'
    else 'user'
  end;
  return new;
end $$ language plpgsql;

-- 3. Add hierarchy_role column to public.titles
alter table public.titles
  add column if not exists hierarchy_role text not null default 'user';

alter table public.titles drop constraint if exists titles_hierarchy_role_check;
alter table public.titles
  add constraint titles_hierarchy_role_check check (hierarchy_role in ('manager', 'team_lead', 'engineer', 'user'));

-- 4. Backfill/update standard titles classifications
update public.titles set hierarchy_role = 'engineer' where name in ('Associate Systems Engineer', 'Systems Engineer', 'Senior Systems Engineer');
update public.titles set hierarchy_role = 'team_lead' where name in ('Team Lead');
update public.titles set hierarchy_role = 'manager' where name in ('Manager');
update public.titles set hierarchy_role = 'user' where hierarchy_role is null or name = 'Intern';
