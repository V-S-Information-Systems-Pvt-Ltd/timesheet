-- Prevent Supabase-mode mobile access tokens from outliving their server-side
-- mobile session or account activation state when used directly via PostgREST.
-- Browser/provider JWTs do not carry sid and therefore keep their existing RLS
-- behaviour.

create or replace function public.mobile_token_session_is_valid()
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, pg_temp
as $$
declare
  sid_claim text := auth.jwt() ->> 'sid';
  caller_id uuid := auth.uid();
  session_id uuid;
begin
  if sid_claim is null or btrim(sid_claim) = '' then
    return true;
  end if;

  -- A signed token carrying sid is a mobile token. Treat malformed session ids
  -- as invalid credentials instead of surfacing a uuid cast error.
  if sid_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;

  if caller_id is null then
    return false;
  end if;

  session_id := sid_claim::uuid;

  return exists (
    select 1
      from public.mobile_sessions as s
      join public.profiles as p on p.id = s.user_id
     where s.id = session_id
       and s.user_id = caller_id
       and s.revoked_at is null
       and s.rotated_at is null
       and s.idle_expires_at > pg_catalog.now()
       and s.absolute_expires_at > pg_catalog.now()
       and p.is_active
  );
end;
$$;

-- Policy expressions execute as the querying role, so authenticated must be
-- able to invoke this helper. SECURITY DEFINER is required to inspect the
-- server-only mobile_sessions table without RLS recursion. The helper returns
-- only a boolean scoped to auth.uid() and the signed sid claim.
revoke all on function public.mobile_token_session_is_valid()
  from public, anon, authenticated;
grant execute on function public.mobile_token_session_is_valid()
  to authenticated;

-- SECURITY DEFINER helpers used by existing RLS policies are also exposed as
-- RPCs to authenticated callers. Make their direct-call behavior honor the
-- same mobile-session revocation boundary. Browser/provider JWTs still pass
-- because mobile_token_session_is_valid() returns true when sid is absent.
create or replace function public.has_role(role_name text)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, pg_temp
as $$
  select public.mobile_token_session_is_valid()
    and exists (
      select 1
        from public.profiles as p
       where p.id = auth.uid()
         and (p.permission_role = role_name or p.hierarchy_role = role_name)
    );
$$;

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
stable
set search_path = pg_catalog, pg_temp
as $$
  select p.name,
         p.email,
         p.role,
         p.permission_role,
         p.hierarchy_role,
         p.is_active,
         p.manager_id
    from public.profiles as p
   where p.id = auth.uid()
     and public.mobile_token_session_is_valid();
$$;

revoke all on function public.has_role(text) from public, anon;
grant execute on function public.has_role(text) to authenticated;
revoke all on function public.my_locked_profile_fields() from public, anon;
grant execute on function public.my_locked_profile_fields() to authenticated;

-- Add one restrictive guard to every public table that currently has RLS
-- enabled. Restrictive policies are ANDed with existing permissive policies.
-- A browser/provider JWT without sid passes this guard unchanged, while a
-- mobile JWT must still reference a live session for both USING and WITH CHECK.
do $$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relrowsecurity
  loop
    execute format(
      'create policy %I on %I.%I as restrictive for all to authenticated using (public.mobile_token_session_is_valid()) with check (public.mobile_token_session_is_valid())',
      'mobile_token_session_guard',
      target.schema_name,
      target.table_name
    );
  end loop;
end;
$$;
