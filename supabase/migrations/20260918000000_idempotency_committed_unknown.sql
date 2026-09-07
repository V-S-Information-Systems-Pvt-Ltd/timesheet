-- supabase/migrations/20260918000000_idempotency_committed_unknown.sql
-- Guard against stale-claim takeover re-execution when a Supabase ledger commit
-- failed after a successful business mutation (defect 1).
--
-- Rows marked committed_unknown = true indicate that the business mutation
-- committed on the database, but recording its result failed after bounded
-- retries. Such rows must NEVER be taken over by stale-claim recovery or re-run.

alter table public.idempotency_keys
  add column if not exists committed_unknown boolean not null default false;
