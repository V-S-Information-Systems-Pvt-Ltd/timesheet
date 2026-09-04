-- supabase/migrations/20260911000000_rate_limits.sql
-- Shared rate-limit counters (Supabase side of db/migrations/0024_rate_limits.sql).
--
-- Replaces the per-process in-memory windows in lib/rate-limit.ts, which could
-- not bound anything once more than one instance served traffic.
--
-- Subjects are never stored in the clear. Emails and IPv4 addresses are
-- low-entropy and fully enumerable, so a plain digest would be reversible by
-- dictionary; lib/rate-limit-subject.ts HMACs them with a server-only key before
-- they reach this table.
--
-- Window boundaries are supplied by the caller rather than computed with now(),
-- so both backends share one clock source and the limiter stays deterministic
-- under test.

create table if not exists public.rate_limits (
  bucket text not null,
  subject_hash text not null,
  window_start timestamptz not null,
  reset_at timestamptz not null,
  count integer not null default 0,
  primary key (bucket, subject_hash, window_start),
  constraint rate_limits_count_nonnegative check (count >= 0),
  constraint rate_limits_window_ordered check (reset_at > window_start),
  constraint rate_limits_bucket_len check (char_length(bucket) between 1 and 64),
  constraint rate_limits_subject_len check (char_length(subject_hash) between 1 and 128)
);

create index if not exists rate_limits_reset_at_idx
  on public.rate_limits (reset_at);

-- No RLS policy can express this table correctly: a rate-limit row is not owned
-- by the subject it counts, and the pre-authentication gates (login, signup,
-- domain-check, password reset) must increment one with no session at all. RLS is
-- therefore enabled with no policies and every grant revoked, so the table is
-- reachable only through the SECURITY DEFINER functions below.
alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- reserve_rate_limit
-- --------------------------------------------------------------------------
-- Atomically claims one unit. Returns the count after the increment, or -1 when
-- the window is already at its limit.
--
-- Single statement, so concurrent workers cannot both observe budget and both
-- proceed: `on conflict ... where count < p_limit` makes the increment
-- conditional inside the row lock the upsert already takes. Losers of the race
-- get no row back, which is the at-limit signal.
--
-- Returning -1 rather than raising keeps "budget exhausted" distinguishable from
-- "storage unavailable" at the call site: the former is a 429, the latter drives
-- the caller's fail-closed or degraded-fallback policy.
create or replace function public.reserve_rate_limit(
  p_bucket text,
  p_subject_hash text,
  p_window_start timestamptz,
  p_reset_at timestamptz,
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_bucket is null or p_subject_hash is null then
    raise exception 'Bucket and subject are required.';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'Limit must be a positive integer.';
  end if;
  if p_window_start is null or p_reset_at is null or p_reset_at <= p_window_start then
    raise exception 'Window bounds are invalid.';
  end if;

  insert into public.rate_limits as r
    (bucket, subject_hash, window_start, reset_at, count)
  values
    (p_bucket, p_subject_hash, p_window_start, p_reset_at, 1)
  on conflict (bucket, subject_hash, window_start) do update
    set count = r.count + 1
  where r.count < p_limit
  returning r.count into v_count;

  if v_count is null then
    return -1;
  end if;
  return v_count;
end;
$$;

revoke all on function public.reserve_rate_limit(text, text, timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_rate_limit(text, text, timestamptz, timestamptz, integer)
  to service_role;

-- --------------------------------------------------------------------------
-- release_rate_limit
-- --------------------------------------------------------------------------
-- Hands a claimed unit back when the guarded action turns out not to be
-- chargeable (a successful login, or a write that failed).
--
-- greatest(count - 1, 0) so a double release cannot drive the window negative
-- and hand out free budget.
create or replace function public.release_rate_limit(
  p_bucket text,
  p_subject_hash text,
  p_window_start timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.rate_limits as r
     set count = greatest(r.count - 1, 0)
   where r.bucket = p_bucket
     and r.subject_hash = p_subject_hash
     and r.window_start = p_window_start;
end;
$$;

revoke all on function public.release_rate_limit(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.release_rate_limit(text, text, timestamptz)
  to service_role;

-- --------------------------------------------------------------------------
-- cleanup_rate_limits
-- --------------------------------------------------------------------------
-- Purges elapsed windows. Called by the CRON_SECRET-protected
-- POST /api/v1/cron/cleanup. `p_before` is passed in rather than using now() so
-- the caller owns the clock.
create or replace function public.cleanup_rate_limits(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed integer;
begin
  delete from public.rate_limits as r where r.reset_at <= p_before;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.cleanup_rate_limits(timestamptz)
  from public, anon, authenticated;
grant execute on function public.cleanup_rate_limits(timestamptz)
  to service_role;
