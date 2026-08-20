-- 20260829000000_lock_role_axes_own_update.sql
-- Close the two-axis self-promotion gap in RLS.
--
-- The original `profiles_update_own_details` policy (20260815000000_features)
-- froze name/email/role/is_active for own-row updates, but the two-axis role
-- model adds permission_role/hierarchy_role AFTER that policy was written, so
-- a user could self-promote by editing those columns directly via PostgREST
-- (they are not compared against the locked snapshot).
--
-- Freeze the two role axes too. Admin-driven role changes flow through the
-- `profiles_update_admin` policy (using has_role('admin')), not this one.

create or replace function public.my_locked_profile_fields()
returns table (
  name text,
  email text,
  role text,
  permission_role text,
  hierarchy_role text,
  is_active boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select name, email, role, permission_role, hierarchy_role, is_active
  from public.profiles
  where id = auth.uid()
$$;

drop policy if exists "profiles_update_own_details" on public.profiles;
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
  );
