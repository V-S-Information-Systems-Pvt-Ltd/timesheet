-- Shared rate-limit counters.
--
-- Replaces the per-process in-memory windows in lib/rate-limit.ts, which could
-- not bound anything once more than one instance served traffic: N replicas meant
-- N times the configured budget, and a restart forgave every offender.
--
-- Subjects are never stored in the clear. Emails and IPv4 addresses are
-- low-entropy and fully enumerable, so a plain digest would be reversible by
-- dictionary; lib/rate-limit-subject.ts HMACs them with a server-only key before
-- they reach this table (contrast mobile_sessions.refresh_token_hash, where the
-- input is 32 random bytes and an unkeyed digest is sound).
--
-- Window boundaries are computed by the caller and passed in, so the limiter
-- stays deterministic under test and the database is a pure atomic counter.

create table if not exists public.rate_limits (
  -- Logical budget (e.g. daily-writes, daily-login). Mixed into subject_hash as
  -- well, so the same subject in two buckets yields unrelated rows.
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

-- Supports the scheduled purge in POST /api/v1/cron/cleanup.
create index if not exists rate_limits_reset_at_idx
  on public.rate_limits (reset_at);
