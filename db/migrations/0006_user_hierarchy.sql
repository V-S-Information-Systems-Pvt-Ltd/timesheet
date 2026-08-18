-- db/migrations/0006_user_hierarchy.sql
-- User hierarchy: Manager -> Team Lead -> Engineer.
--
-- Adds a self-referencing manager_id on profiles and a recursive helper that
-- returns all direct + indirect reports of a user. The native backend enforces
-- visibility in the repository SQL using this helper (no RLS dependency).

alter table public.profiles
  add column if not exists manager_id uuid references public.profiles (id) on delete set null;

-- 0001 constrained role to (admin, pm, co, user); widen it so the new
-- hierarchy roles can actually be assigned to profiles.
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'pm', 'co', 'manager', 'team_lead', 'user'));

create index if not exists profiles_manager_id_idx on public.profiles (manager_id);

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