-- Make the Supabase role helper honor both independent role axes.
--
-- The legacy `role` column is derived from permission_role first, so a user
-- with permission_role = 'pm' and hierarchy_role = 'manager' has role = 'pm'.
-- Checking only `role` therefore prevents that user from matching the team
-- hierarchy RLS policies. Keep the helper signature stable and check both
-- canonical columns instead.

create or replace function public.has_role(role_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (p.permission_role = role_name or p.hierarchy_role = role_name)
  );
$$;

grant execute on function public.has_role(text) to authenticated;
