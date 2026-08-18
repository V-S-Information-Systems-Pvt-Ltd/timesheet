-- User hierarchy: Manager -> Team Lead -> Engineer.
--
-- Adds a self-referencing manager_id on profiles and a recursive helper that
-- returns all direct + indirect reports of a user. RLS policies use it so
-- managers and team leads can view their team's timesheet entries and list
-- their team's profiles (for the entries user filter).

alter table public.profiles
  add column if not exists manager_id uuid references public.profiles (id) on delete set null;

-- 20260810180000 constrained role to (admin, pm, co, user); widen it so the
-- new hierarchy roles can actually be assigned to profiles.
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'pm', 'co', 'manager', 'team_lead', 'user'));

create index if not exists profiles_manager_id_idx on public.profiles (manager_id);

-- Direct + indirect reports of `target` (does not include target themselves).
-- security definer: reads profiles without RLS recursion from policies.
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

grant execute on function public.team_ids(uuid) to authenticated;

-- Managers and team leads may view timesheet entries of everyone in their team.
create policy "timesheets_select_team" on public.timesheets
  for select to authenticated
  using (
    (public.has_role('manager') or public.has_role('team_lead'))
    and user_id = any(public.team_ids(auth.uid()))
  );

-- Managers and team leads may list their team's profiles (own row is covered by
-- the existing profiles_select_own policy).
create policy "profiles_select_team" on public.profiles
  for select to authenticated
  using (
    (public.has_role('manager') or public.has_role('team_lead'))
    and id = any(public.team_ids(auth.uid()))
  );