-- Serialize password-change revocation with refresh rotation.
-- Only the service role may invoke this helper.

alter table public.profiles
  add column if not exists mobile_password_change_started_at timestamptz;

-- A password change makes an external Supabase Auth request after its initial
-- database transaction commits. Keep a persisted guard across that request so
-- a concurrent refresh cannot mint a replacement session in the gap.
create or replace function public.block_mobile_session_creation_during_password_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
      from public.profiles as p
     where p.id = new.user_id
       and p.mobile_password_change_started_at is not null
  ) then
    raise exception 'Mobile session changes are temporarily locked during password change.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists mobile_sessions_block_password_change on public.mobile_sessions;
create trigger mobile_sessions_block_password_change
before insert on public.mobile_sessions
for each row execute function public.block_mobile_session_creation_during_password_change();

revoke all on function public.block_mobile_session_creation_during_password_change()
  from public, anon, authenticated;
grant execute on function public.block_mobile_session_creation_during_password_change()
  to service_role;

create or replace function public.revoke_other_mobile_sessions_tx(
  p_user_id uuid,
  p_preserve_session_id uuid,
  p_now timestamptz default now()
)
returns table (status text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  preserved public.mobile_sessions%rowtype;
begin
  -- A refresh that started first must finish before the later statements take
  -- fresh snapshots; a refresh that starts second blocks on these session rows.
  perform s.id
    from public.mobile_sessions as s
   where s.user_id = p_user_id
   order by s.id
   for update;

  -- Keep the same sessions-before-profile lock order used by native password
  -- change, and block new child-row inserts at their FK check until commit.
  perform p.id
    from public.profiles as p
   where p.id = p_user_id
   for update;

  select * into preserved
    from public.mobile_sessions as s
   where s.id = p_preserve_session_id
     and s.user_id = p_user_id;

  if not found
     or preserved.revoked_at is not null
     or preserved.rotated_at is not null
     or preserved.idle_expires_at <= p_now
     or preserved.absolute_expires_at <= p_now then
    return query select 'conflict'::text;
    return;
  end if;

  update public.mobile_sessions as s
     set revoked_at = coalesce(s.revoked_at, p_now)
   where s.user_id = p_user_id
     and s.id <> p_preserve_session_id
     and s.revoked_at is null;

  update public.profiles as p
     set mobile_password_change_started_at = p_now
   where p.id = p_user_id;

  return query select 'revoked'::text;
end;
$$;

revoke all on function public.revoke_other_mobile_sessions_tx(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.revoke_other_mobile_sessions_tx(uuid, uuid, timestamptz)
  to service_role;

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
  -- Lock sessions before the profile row, matching refresh rotation and the
  -- start RPC. The guard remains set until both locks are held and all late
  -- sessions have been revoked.
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
     and s.id <> p_preserve_session_id
     and s.revoked_at is null;

  update public.profiles as p
     set mobile_password_change_started_at = null
   where p.id = p_user_id;
end;
$$;

revoke all on function public.complete_mobile_password_change_tx(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_mobile_password_change_tx(uuid, uuid, timestamptz)
  to service_role;
