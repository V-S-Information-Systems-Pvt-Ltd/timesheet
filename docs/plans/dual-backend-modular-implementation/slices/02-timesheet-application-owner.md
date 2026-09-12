# 02 Timesheet operations have one application owner

**What to build:** Make every equivalent timesheet operation use one authoritative application implementation while preserving Server Action, `/api/data`, and `/api/v1` contracts and both persistence providers.

**Blocked by:** 01.

## Approach

- Turn the existing timesheet dependency object into required narrow persistence, clock, and write-budget dependencies; remove fallback resolution of the global repository.
- Define the timesheet port from the operations the service actually needs. Implement it for native PostgreSQL and request-scoped Supabase, then compose it at server entry boundaries.
- Validate canonical inputs inside the application boundary. Keep FormData/JSON parsing, HTTP status/error envelopes, revalidation, and DTO mapping in transport adapters.
- Consolidate reserve/release behavior into one application wrapper so each operation or batch is charged once, including partial-success and failed-write release rules.
- Preserve database enforcement of concurrent daily-hour limits and the current idempotency protocol. Stamped create/update/delete writes retain immutable effect evidence in the business-write transaction, database-computed payload fingerprints, recovery, and conflict detection. Duplicate and batch operations retain their ledger-replay-only response contracts and authorization rechecks. All paths retain write-budget release when a duplicate delivery or failed write is not chargeable. Keep response replay outside pure business rules and provider-specific effect recording inside the persistence adapter.
- Migrate one operation through actions and HTTP first, prove parity, then migrate create/update/delete/duplicate/list and batch operations.

## Acceptance criteria

- [ ] Timesheet policy changes have one application implementation for actions, `/api/data`, and `/api/v1`.
- [ ] Ownership, inactive-user, both role-axis, backfill, validation, daily-cap, duplicate, batch, and partial-success outcomes match the implementation-start web behavior unless a deliberate difference is documented.
- [ ] Application operations receive actor, persistence, clock, and write-budget dependencies explicitly and import no cookies, Request, headers, HTTP helpers, or globally selected repository.
- [ ] Native and Supabase ports preserve authorization, RLS, transaction, concurrency, and provider error semantics.
- [ ] Public action signatures, endpoint URLs, response DTOs, and error envelopes remain compatible. Stamped create/update/delete operations preserve immutable-effect recovery and different-payload conflict; duplicate and batch operations preserve ledger-only response replay and authorization rechecks; all keyed paths preserve fail-closed unknown outcomes and exactly-once write-budget charging.

## Verification

```powershell
npx vitest run tests/timesheet-domain.test.ts tests/actions.test.ts tests/action-policy.test.ts tests/mobile-timesheets-route.test.ts tests/mobile-timesheet-duplicate-route.test.ts tests/mobile-timesheets-batch-delete-route.test.ts tests/mobile-timesheets-batch-duplicate-route.test.ts tests/idempotency-stamp-recovery.test.ts tests/batch-duplicate-reauthorize.test.ts tests/parity-tracer.test.ts
npx vitest run tests/daily-hours-concurrency.int.test.ts
```

Expected: transport outcomes are parity-covered; idempotent replays preserve effect, conflict, reauthorization, and budget semantics; and the concurrency test passes against migrated disposable PostgreSQL rather than skipping.

## STOP conditions

- A provider cannot implement the narrow port without weakening RLS/SQL authorization or splitting an existing atomic write.
- Moving a write behind the narrow port cannot retain its existing stamped-effect or ledger-only replay model, database-authoritative fingerprint comparison where applicable, replay reauthorization, or exactly-once budget accounting.
- Current action or v1 behavior contradicts the architecture's “web-canonical” rule and product intent cannot be inferred from tests.
