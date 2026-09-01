-- supabase/migrations/20260905000000_freeze_manager_id_own_update.sql
-- Freeze manager_id for own-row updates.
--
-- profiles_update_own_details froze name/email/role/permission_role/
-- hierarchy_role/is_active, but manager_id was added by the hierarchy
-- feature afterwards and remained self-writable via PostgREST. The
-- reporting line is admin-managed everywhere else (setUserManager /
-- updateUserHierarchy guard self-changes and cycles, then audit), so a
-- user could silently rewrite their own manager — e.g. to evade their
-- manager's team-scoped visibility — bypassing those guards.
--
-- Native mode is safe by construction: updateMyProfile updates only
-- department/title.

drop policy if exists "profiles_update_own_details" on public.profiles;
drop function if exists public.my_locked_profile_fields();

create or replace function public.my_locked_profile_fields()
returns table (
  name text,
  email text,
  role text,
  permission_role text,
  hierarchy_role text,
  is_active boolean,
  manager_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select name, email, role, permission_role, hierarchy_role, is_active, manager_id
  from public.profiles
  where id = auth.uid()
$$;

create policy "profiles_update_own_details" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and name = (select name from public.my_locked_profile_fields())
    and email = (select email from public.my_locked_profile_fields())
    and role = (select role from public.my_locked_profile_fields())
    and permission_role = (select permission_role from public.my_locked_profile_fields())
    and hierarchy_role = (select hierarchy_role from public.my_locked_profile_fields())
    and is_active = (select is_active from public.my_locked_profile_fields())
    and manager_id = (select manager_id from public.my_locked_profile_fields())
  );
