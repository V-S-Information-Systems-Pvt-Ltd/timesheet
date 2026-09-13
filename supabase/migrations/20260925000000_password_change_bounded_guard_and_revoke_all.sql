-- Close the remaining password-change session-revocation gaps left by
-- 20260924000000:
--
-- 1. The insert guard had no recency bound. A process crash (or a failed
--    completion RPC) between the start RPC and the completion RPC left
--    mobile_password_change_started_at set forever, so the trigger blocked
--    every subsequent mobile_sessions INSERT -- refresh rotation AND fresh
--    sign-in -- permanently locking the user out of mobile. The guard now
--    only blocks a recent window; an abandoned guard is treated as expired,
--    every pre-change session is revoked, the guard is cleared, and the
--    inserting session becomes the first post-change session.
--
-- 2. The web caller (browser change-password / recovery) revoked mobile
--    sessions with a plain UPDATE that neither locked rows nor set the guard,
--    then made its provider password write in a separate request. A refresh
--    rotation committing in that gap minted a replacement session that
--    survived the password change. revoke_all_mobile_sessions_tx applies the
--    same lock + guard discipline as the mobile path, with no preserved
--    session.
--
-- 3. complete_mobile_password_change_tx now accepts a null preserved session
--    so the web caller (which keeps no custom mobile session) can clear the
--    guard and sweep late arrivals.

-- 1. Bounded insert guard with abandoned-change recovery.
create or replace function public.block_mobile_session_creation_during_password_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  guard_started_at timestamptz;
begin
  select p.mobile_password_change_started_at
    into guard_started_at
    from public.profiles as p
   where p.id = new.user_id;

  if guard_started_at is null then
    return new;
  end if;

  -- In-flight window: the provider write happens after the start RPC commits
  -- and before the completion RPC. Block new sessions so a concurrent refresh
  -- cannot mint a replacement that outlives the password change.
  if guard_started_at > now() - interval '5 minutes' then
    raise exception 'Mobile session changes are temporarily locked during password change.'
      using errcode = '55000';
  end if;

  -- Abandoned change: the process died before completion. Fail closed by
  -- revoking every session that predates this insert, clear the guard, and
  -- let this insert proceed as the first post-change session.
  update public.mobile_sessions as s
     set revoked_at = coalesce(s.revoked_at, now())
   where s.user_id = new.user_id
     and s.revoked_at is null;

  update public.profiles as p
     set mobile_password_change_started_at = null
   where p.id = new.user_id;

  return new;
end;
$$;

revoke all on function public.block_mobile_session_creation_during_password_change()
  from public, anon, authenticated;
grant execute on function public.block_mobile_session_creation_during_password_change()
  to service_role;

-- 2. Web caller: revoke every mobile session and set the same insert guard.
create or replace function public.revoke_all_mobile_sessions_tx(
  p_user_id uuid,
  p_now timestamptz default now()
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform s.id
    from public.mobile_sessions as s
   where s.user_id = p_user_id
   order by s.id
   for update;

  perform p.id
    from public.profiles as p
   where p.id = p_user_id
   for update;

  update public.mobile_sessions as s
     set revoked_at = coalesce(s.revoked_at, p_now)
   where s.user_id = p_user_id
     and s.revoked_at is null;

  update public.profiles as p
     set mobile_password_change_started_at = p_now
   where p.id = p_user_id;
end;
$$;

revoke all on function public.revoke_all_mobile_sessions_tx(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.revoke_all_mobile_sessions_tx(uuid, timestamptz)
  to service_role;

-- 3. Completion accepts a null preserved session (web caller preserves none).
create or replace function public.complete_mobile_password_change_tx(
  p_user_id uuid,
  p_preserve_session_id uuid,
  p_now timestamptz default now()
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform s.id
    from public.mobile_sessions as s
   where s.user_id = p_user_id
   order by s.id
   for update;

  perform p.id
    from public.profiles as p
   where p.id = p_user_id
   for update;

  update public.mobile_sessions as s
     set revoked_at = coalesce(s.revoked_at, p_now)
   where s.user_id = p_user_id
     and s.revoked_at is null
     and (p_preserve_session_id is null or s.id <> p_preserve_session_id);

  update public.profiles as p
     set mobile_password_change_started_at = null
   where p.id = p_user_id;
end;
$$;

revoke all on function public.complete_mobile_password_change_tx(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_mobile_password_change_tx(uuid, uuid, timestamptz)
  to service_role;
