-- supabase/migrations/20260911000001_pin_mobile_session_rotation.sql
-- Re-establish a known rotate_mobile_session body and harden its search_path.
--
-- Two separate problems are addressed here.
--
-- 1. Ambiguous column references (functional).
--    20260904000000_mobile_sessions.sql declared the function's result columns
--    via RETURNS TABLE (refresh_token_hash, family_id, revoked_at, ...), which
--    PL/pgSQL exposes as variables that shadow the table's own columns. Every
--    unqualified reference in that body therefore raised
--    "column reference ... is ambiguous" — and because PL/pgSQL parses bodies
--    lazily, `create or replace` succeeded and the failure only appeared on the
--    first POST /api/v1/auth/refresh. 20260905000000_fix_mobile_session_rotation.sql
--    corrected it by aliasing the table as `s` and qualifying every reference.
--
-- 2. Which body a given database actually holds is not knowable from migration
--    history (identity).
--    Version 20260905000000 was used by three different SQL bodies across
--    branches, and origin/main still ships 20260905000000_freeze_manager_id_own_update.sql
--    under that same version. Supabase reconciles on version, not content, so a
--    database seeded from main recorded 20260905000000 and will never apply the
--    rotation repair. This migration carries a fresh monotonic post-head version,
--    so it applies exactly once everywhere regardless of what 20260905000000 meant
--    in any given environment.
--
-- 3. search_path hardening.
--    Both earlier definitions pinned `search_path = public`, omitting pg_temp. In
--    a SECURITY DEFINER function that leaves the door open to temp-schema object
--    shadowing: an attacker able to create a temp table or operator that matches
--    an unqualified reference could have it resolved in preference to the real
--    object. Pinning `public, pg_temp` puts pg_temp last, so it can no longer
--    shadow anything. This matches bulk_update_timesheets and
--    reclassify_title_atomic.
--
-- The body below is byte-identical in behaviour to 20260905000000; only the
-- search_path line differs. Verified properties, asserted in
-- tests/supabase-migrations.test.ts:
--   * replay of a rotated or superseded token revokes the WHOLE family
--   * expiry revokes only the presented session
--   * the replacement's idle window never outlives the family's absolute window
--   * execution is service_role only

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
set search_path = public, pg_temp
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
    -- The presented token is a predecessor: it was already rotated away, so its
    -- reappearance means the token was captured. Revoke the entire family.
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
    -- Same conclusion as above, reached from the other direction: this row still
    -- exists but has already handed out a successor.
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
    -- Expiry is not evidence of compromise, so only this session is revoked.
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
