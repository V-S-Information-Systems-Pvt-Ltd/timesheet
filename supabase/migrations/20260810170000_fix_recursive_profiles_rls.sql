-- Fix: "infinite recursion detected in policy for relation profiles"
--
-- The hosted database was set up before the is_admin() SECURITY DEFINER
-- helper existed (or without it), so its profiles policies check admin
-- status by querying profiles directly. PostgreSQL detects that the policy
-- is scanning the same table it is protecting and aborts with infinite
-- recursion.
--
-- This migration brings RLS in line with the reference design:
--   1. Create the security definer helper (bypasses RLS when called from
--      policies, so the admin check does not recurse).
--   2. Drop every existing policy on profiles/projects/timesheets.
--   3. Recreate the reference policy set from initial_schema.sql.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and is_admin
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- Drop all current policies on the three tables so stale or recursive
-- policies cannot linger regardless of their names.
do $$
declare
  t text;
  p text;
begin
  foreach t in array array['profiles', 'projects', 'timesheets'] loop
    if exists (
      select 1 from pg_tables
      where schemaname = 'public' and tablename = t
    ) then
      for p in
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = t
      loop
        execute format('drop policy %I on public.%I', p, t);
      end loop;
    end if;
  end loop;
end
$$;

-- profiles: users see their own row; admins see everything.
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

create policy "profiles_select_admin" on public.profiles
  for select to authenticated
  using (public.is_admin());

-- Only admins can update profiles (whitelist / admin role toggles).
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- projects: any signed-in user can view; only admins can add.
create policy "projects_select_authenticated" on public.projects
  for select to authenticated
  using (true);

create policy "projects_insert_admin" on public.projects
  for insert to authenticated
  with check (public.is_admin());

-- timesheets: users manage their own rows; admins can view everything.
-- Inserts also require an active profile (pending accounts cannot log time).
create policy "timesheets_select_own" on public.timesheets
  for select to authenticated
  using (auth.uid() = user_id);

create policy "timesheets_select_admin" on public.timesheets
  for select to authenticated
  using (public.is_admin());

create policy "timesheets_insert_own_active" on public.timesheets
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_active
    )
  );
