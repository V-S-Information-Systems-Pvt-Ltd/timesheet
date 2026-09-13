-- Drop authenticated-user policy and revoke direct table access.
-- All idempotency ledger operations are performed via service_role or atomic backend services.

drop policy if exists idempotency_keys_own on public.idempotency_keys;

revoke all on table public.idempotency_keys from public, anon, authenticated;
grant select, insert, update, delete on table public.idempotency_keys to service_role;
