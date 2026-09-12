-- Follow-up hardening for remediation-era SECURITY DEFINER functions and the
-- mobile-session restrictive RLS overlay.
--
-- Migrations through 20260926000000 have already been applied to the linked
-- hosted project, so fixes for their final state must ship as a forward
-- migration rather than by rewriting those applied files.

-- The linked project currently owns these functions as postgres. Pin that
-- ownership explicitly so the SECURITY DEFINER execution identity is part of
-- the migration contract instead of an implicit side effect of who ran the
-- original CREATE FUNCTION statement.

-- Keep the already-applied 20260926000000 migration immutable. The guarded
-- team_ids() replacement therefore ships here as a forward fix so fresh
-- databases and the hosted project converge on the same final definition.
create or replace function public.team_ids(target uuid)
returns uuid[]
language sql
security definer
stable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when public.mobile_token_session_is_valid() and target = auth.uid() then (
      with recursive team as (
        select p.id
          from public.profiles as p
         where p.manager_id = target
        union
        select p.id
          from public.profiles as p
          join team as t on p.manager_id = t.id
      )
      select array(select id from team)
    )
    else array[]::uuid[]
  end;
$$;

revoke all on function public.team_ids(uuid) from public, anon, authenticated;
grant execute on function public.team_ids(uuid) to authenticated;

alter function public.restore_backup_tx(jsonb) owner to postgres;

alter function private.claim_idempotency_effect(text, text, text, text) owner to postgres;
alter function private.commit_idempotency_effect(text, text, integer) owner to postgres;
alter function private.mobile_idempotency_claim() owner to postgres;
alter function private.mobile_idempotency_commit() owner to postgres;

alter function public.block_mobile_session_creation_during_password_change() owner to postgres;

alter function public.mobile_token_session_is_valid() owner to postgres;
alter function public.has_role(text) owner to postgres;
alter function public.my_locked_profile_fields() owner to postgres;
alter function public.team_ids(uuid) owner to postgres;

-- mobile_token_session_is_valid() is statement-invariant. Put the call behind
-- a scalar subquery so PostgreSQL can plan it as an initPlan instead of
-- invoking the SECURITY DEFINER helper once per row scanned by each policy.
-- Keep the migration resilient if an RLS table was added after the original
-- overlay: alter an existing guard, or create the same restrictive guard when
-- it is missing.
do $$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name, c.oid as table_oid
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relrowsecurity
  loop
    if exists (
      select 1
        from pg_catalog.pg_policy as p
       where p.polrelid = target.table_oid
         and p.polname = 'mobile_token_session_guard'
    ) then
      execute format(
        'alter policy %I on %I.%I using ((select public.mobile_token_session_is_valid())) with check ((select public.mobile_token_session_is_valid()))',
        'mobile_token_session_guard',
        target.schema_name,
        target.table_name
      );
    else
      execute format(
        'create policy %I on %I.%I as restrictive for all to authenticated using ((select public.mobile_token_session_is_valid())) with check ((select public.mobile_token_session_is_valid()))',
        'mobile_token_session_guard',
        target.schema_name,
        target.table_name
      );
    end if;
  end loop;
end;
$$;
