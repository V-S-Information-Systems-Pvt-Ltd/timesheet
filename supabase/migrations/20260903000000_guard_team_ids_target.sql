-- 20260903000000_guard_team_ids_target.sql
-- Close an information-disclosure side channel on public.team_ids(uuid).
--
-- team_ids is SECURITY DEFINER (so policies can traverse profiles without RLS
-- recursion) and granted to authenticated. Its body accepted an ARBITRARY
-- target uuid, so any signed-in user could call it via PostgREST RPC with
-- another profile's id and enumerate that person's direct + indirect reports
-- — mapping the org hierarchy and harvesting profile UUIDs that the
-- profiles_select_* visibility policies never exposed to them.
--
-- Every legitimate caller (the timesheets_select_team / profiles_select_team
-- policies) passes auth.uid() as the target, so guard the body: return an
-- empty array unless target = auth.uid(). Policy behavior is unchanged.
--
-- The native backend keeps its own unguarded definition in
-- db/migrations/0006_user_hierarchy.sql: native has no auth.uid() context
-- (single pool role) and enforces leader scoping in repository SQL instead.

create or replace function public.team_ids(target uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case when target = auth.uid() then (
    with recursive team as (
      select id from public.profiles where manager_id = target
      union
      select p.id from public.profiles p join team t on p.manager_id = t.id
    )
    select array(select id from team)
  ) else array[]::uuid[] end;
$$;
