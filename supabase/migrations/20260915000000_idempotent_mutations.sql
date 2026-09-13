-- supabase/migrations/20260915000000_idempotent_mutations.sql
-- Idempotency ledger hardening for mobile offline operations.
--
-- A previous revision of this migration created a raw-SQL
-- `execute_idempotent_mutation` executor. That executor bypassed domain rules
-- (backfill window, 24h cap, sanitization) and authorized with the legacy
-- single `role` column instead of the two-axis
-- `permission_role` x `hierarchy_role` model, so it has been removed. The
-- application path in `lib/idempotency.ts` always runs the business mutation
-- through `execute()` (domain/repository under the request-scoped bearer
-- client) and uses the ledger only for claim/commit/replay keyed by
-- (key, actor_id, operation) with a payload fingerprint.
--
-- The `idempotency_keys` table itself is created in
-- 20260913010000_idempotency_keys.sql (service_role-only ledger access).

drop function if exists public.execute_idempotent_mutation(text, uuid, text, text, jsonb);
