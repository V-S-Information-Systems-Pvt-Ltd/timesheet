-- db/migrations/0028_idempotent_mutations.sql
-- Idempotency ledger hardening (Native parity).
--
-- A previous revision of this migration created a raw-SQL
-- `execute_idempotent_mutation` executor. That executor bypassed domain rules
-- (backfill window, 24h cap, sanitization) and authorized with the legacy
-- single `role` column instead of the two-axis
-- `permission_role` x `hierarchy_role` model, so it has been removed. The
-- application path in `lib/idempotency.ts` always runs the business mutation
-- through `execute()` (domain/repository) and uses the ledger only for
-- claim/commit/replay keyed by (key, actor_id, operation) with a payload
-- fingerprint. Uniqueness on that key plus in-flight (status=0) handling
-- provides the exactly-once guarantee on both backends.
--
-- The `idempotency_keys` table itself is created in 0026_idempotency_keys.sql.

drop function if exists public.execute_idempotent_mutation(text, uuid, text, text, jsonb);

-- No grants: there is no privileged executor left to expose. Ledger rows are
-- managed by the application pool user within the caller's transaction
-- (native) or the service_role-backed ledger helpers (Supabase, see
-- 20260913010000 migration grants).
