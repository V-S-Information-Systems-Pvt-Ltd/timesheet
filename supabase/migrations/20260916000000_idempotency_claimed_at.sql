-- supabase/migrations/20260916000000_idempotency_claimed_at.sql
-- Stale in-flight claim recovery for offline replay (T19.2).
--
-- A claim row stuck at response_status = 0 (e.g. crash between a successful
-- mutation and the ledger commit) must not poison its key forever. Claims
-- carry a timestamp so a retry can atomically take over an abandoned claim
-- (see lib/idempotency.ts claimIdempotencyKey) instead of conflicting until
-- the 97-day retention cleanup. Additive column; table stays service_role
-- only (RLS policies unchanged).

alter table public.idempotency_keys
  add column if not exists claimed_at timestamptz not null default now();
