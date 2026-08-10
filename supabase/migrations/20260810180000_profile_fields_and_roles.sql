-- Profile fields (name/department/title) and role-based access.
--
-- Roles: admin (everything), pm (add projects), co (generate reports,
-- view all data), user (log time, view own data). Replaces the legacy
-- is_admin boolean flag.

-- 1. New profile fields + role column
alter table public.profiles
  add column if not exists name text not null default '',
  add column if not exists department text not null default '',
  add column if not exists title text not null default '',
  add column if not exists role text not null default 'user'
    check (role in ('admin', 'pm', 'co', 'user'));

-- 2. Backfill role from the legacy is_admin flag, then drop the flag
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'is_admin'
  ) then
    update public.profiles set role = 'admin' where is_admin;
    alter table public.profiles drop column if exists is_admin;
  end if;
end
$$;

-- 3. Drop all existing policies first (they may reference is_admin)
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

-- 4. Remove the old helper; it references the dropped is_admin column
drop function if exists public.is_admin();

-- 5. Role helper (SECURITY DEFINER so policies can check roles without
--    recursing back into profiles)
create or replace function public.has_role(role_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = role_name
  );
$$;

grant execute on function public.has_role(text) to authenticated;

-- 6. Recreate policies
-- profiles: users see their own row; admins and COs see everything
-- (CO needs all profiles for report generation).
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

create policy "profiles_select_management" on public.profiles
  for select to authenticated
  using (public.has_role('admin') or public.has_role('co'));

-- Only admins can update profiles (whitelist / role toggles / manual adds).
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- projects: any signed-in user can view; admins and PMs can add.
create policy "projects_select_authenticated" on public.projects
  for select to authenticated
  using (true);

create policy "projects_insert_manager" on public.projects
  for insert to authenticated
  with check (public.has_role('admin') or public.has_role('pm'));

-- timesheets: users manage their own rows; admins and COs can view
-- everything (CO needs it for reports). Inserts require an active profile.
create policy "timesheets_select_own" on public.timesheets
  for select to authenticated
  using (auth.uid() = user_id);

create policy "timesheets_select_management" on public.timesheets
  for select to authenticated
  using (public.has_role('admin') or public.has_role('co'));

create policy "timesheets_insert_own_active" on public.timesheets
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_active
    )
  );

-- 7. Capture the name supplied at sign-up; ensure the profile auto-create
--    trigger exists for new auth users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
