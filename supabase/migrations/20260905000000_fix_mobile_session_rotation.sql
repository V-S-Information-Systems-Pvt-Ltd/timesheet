-- Fix rotate_mobile_session: the function's RETURNS TABLE columns (e.g.
-- refresh_token_hash, family_id, revoked_at, ...) shadow the table's column
-- names inside PL/pgSQL, so every unqualified reference in the original
-- migration (20260904000000_mobile_sessions.sql) was resolved as
-- "column reference ... is ambiguous" at runtime, making POST /api/v1/auth/refresh
-- fail with a 500.
--
-- This migration recreates the function with the mobile_sessions table
-- aliased as `s` and all expression-level column references qualified.

create or replace function public.rotate_mobile_session(
  p_presented_token_hash text,
  p_replacement_token_hash text,
  p_now timestamptz default now()
)
returns table (
  status text,
  session_id uuid,
  user_id uuid,
  family_id uuid,
  refresh_token_hash text,
  previous_token_hash text,
  device_name text,
  platform text,
  created_at timestamptz,
  last_used_at timestamptz,
  idle_expires_at timestamptz,
  absolute_expires_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  replaced_by_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_session public.mobile_sessions%rowtype;
  replacement public.mobile_sessions%rowtype;
begin
  select * into current_session
    from public.mobile_sessions as s
   where s.refresh_token_hash = p_presented_token_hash
   for update;

  if not found then
    select * into current_session
      from public.mobile_sessions as s
     where s.previous_token_hash = p_presented_token_hash
     for update;
    if found then
      update public.mobile_sessions as s
         set revoked_at = coalesce(s.revoked_at, p_now)
       where s.family_id = current_session.family_id and s.revoked_at is null;
      return query select 'reused', current_session.id, current_session.user_id,
        current_session.family_id, current_session.refresh_token_hash,
        current_session.previous_token_hash, current_session.device_name,
        current_session.platform, current_session.created_at,
        current_session.last_used_at, current_session.idle_expires_at,
        current_session.absolute_expires_at, current_session.rotated_at,
        current_session.revoked_at, current_session.replaced_by_id;
      return;
    end if;
    return query select 'invalid', null::uuid, null::uuid, null::uuid,
      null::text, null::text, null::text, null::text, null::timestamptz,
      null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz,
      null::timestamptz, null::uuid;
    return;
  end if;

  if current_session.rotated_at is not null then
    update public.mobile_sessions as s
       set revoked_at = coalesce(s.revoked_at, p_now)
     where s.family_id = current_session.family_id and s.revoked_at is null;
    return query select 'reused', current_session.id, current_session.user_id,
      current_session.family_id, current_session.refresh_token_hash,
      current_session.previous_token_hash, current_session.device_name,
      current_session.platform, current_session.created_at,
      current_session.last_used_at, current_session.idle_expires_at,
      current_session.absolute_expires_at, current_session.rotated_at,
      current_session.revoked_at, current_session.replaced_by_id;
    return;
  end if;
  if current_session.revoked_at is not null then
    return query select 'revoked', current_session.id, current_session.user_id,
      current_session.family_id, current_session.refresh_token_hash,
      current_session.previous_token_hash, current_session.device_name,
      current_session.platform, current_session.created_at,
      current_session.last_used_at, current_session.idle_expires_at,
      current_session.absolute_expires_at, current_session.rotated_at,
      current_session.revoked_at, current_session.replaced_by_id;
    return;
  end if;
  if current_session.idle_expires_at <= p_now or current_session.absolute_expires_at <= p_now then
    update public.mobile_sessions as s set revoked_at = p_now where s.id = current_session.id;
    return query select 'expired', current_session.id, current_session.user_id,
      current_session.family_id, current_session.refresh_token_hash,
      current_session.previous_token_hash, current_session.device_name,
      current_session.platform, current_session.created_at,
      current_session.last_used_at, current_session.idle_expires_at,
      current_session.absolute_expires_at, current_session.rotated_at,
      p_now, current_session.replaced_by_id;
    return;
  end if;

  insert into public.mobile_sessions
    (user_id, family_id, refresh_token_hash, previous_token_hash, device_name,
     platform, created_at, last_used_at, idle_expires_at, absolute_expires_at)
  values
    (current_session.user_id, current_session.family_id, p_replacement_token_hash,
     current_session.refresh_token_hash, current_session.device_name,
     current_session.platform, p_now, p_now,
     least(p_now + interval '30 days', current_session.absolute_expires_at),
     current_session.absolute_expires_at)
  returning * into replacement;

  update public.mobile_sessions as s
     set rotated_at = p_now, last_used_at = p_now, replaced_by_id = replacement.id
   where s.id = current_session.id;

  return query select 'rotated', replacement.id, replacement.user_id,
    replacement.family_id, replacement.refresh_token_hash,
    replacement.previous_token_hash, replacement.device_name,
    replacement.platform, replacement.created_at, replacement.last_used_at,
    replacement.idle_expires_at, replacement.absolute_expires_at,
    replacement.rotated_at, replacement.revoked_at, replacement.replaced_by_id;
end;
$$;

revoke all on function public.rotate_mobile_session(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.rotate_mobile_session(text, text, timestamptz)
  to service_role;