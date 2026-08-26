-- db/migrations/0016_cycle_safe_team_ids.sql
-- Harden public.team_ids against reporting-cycle loops.
--
-- The application guards manager assignments against cycles
-- (app/actions/users.ts setUserManager / updateUserHierarchy), but a
-- concurrent-admin race or an out-of-band database edit could still
-- introduce one. The recursive CTE here used UNION ALL, which does NOT
-- terminate on a cycle: any leader-scoped timesheet/profile query
-- (`t.user_id = any(public.team_ids($1))`) would recurse until the
-- connection/pool exhausts memory.
--
-- The supabase variant already dedupes with UNION for exactly this reason
-- (supabase/migrations/20260819000000_user_hierarchy.sql); bring native in
-- line. No behavioral change for acyclic data (UNION only removes duplicate
-- visited ids during traversal).

create or replace function public.team_ids(target uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive team as (
    select id from public.profiles where manager_id = target
    union
    select p.id from public.profiles p join team t on p.manager_id = t.id
  )
  select array(select id from team)
$$;
