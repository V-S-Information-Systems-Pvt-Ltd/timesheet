# 02 Timesheet operations have one application owner

**What to build:** Make every equivalent timesheet operation use one authoritative application implementation while preserving Server Action, `/api/data`, and `/api/v1` contracts and both persistence providers.

**Blocked by:** 01.

## Approach

- Turn the existing timesheet dependency object into required narrow persistence, clock, and write-budget dependencies; remove fallback resolution of the global repository.
- Define the timesheet port from the operations the service actually needs. Implement it for native PostgreSQL and request-scoped Supabase, then compose it at server entry boundaries.
- Validate canonical inputs inside the application boundary. Keep FormData/JSON parsing, HTTP status/error envelopes, revalidation, and DTO mapping in transport adapters.
- Consolidate reserve/release behavior into one application wrapper so each operation or batch is charged once, including partial-success and failed-write release rules.
- Preserve database enforcement of concurrent daily-hour limits and existing transaction/idempotency ownership.
- Migrate one operation through actions and HTTP first, prove parity, then migrate create/update/delete/duplicate/list and batch operations.

## Acceptance criteria

- [ ] Timesheet policy changes have one application implementation for actions, `/api/data`, and `/api/v1`.
- [ ] Ownership, inactive-user, both role-axis, backfill, validation, daily-cap, duplicate, batch, and partial-success outcomes match the implementation-start web behavior unless a deliberate difference is documented.
- [ ] Application operations receive actor, persistence, clock, and write-budget dependencies explicitly and import no cookies, Request, headers, HTTP helpers, or globally selected repository.
- [ ] Native and Supabase ports preserve authorization, RLS, transaction, concurrency, and provider error semantics.
- [ ] Public action signatures, endpoint URLs, response DTOs, error envelopes, and existing idempotency behavior remain compatible.

## Verification

```powershell
npx vitest run tests/timesheet-domain.test.ts tests/actions.test.ts tests/action-policy.test.ts tests/mobile-timesheets-route.test.ts tests/mobile-timesheet-duplicate-route.test.ts tests/mobile-timesheets-batch-delete-route.test.ts tests/mobile-timesheets-batch-duplicate-route.test.ts tests/parity-tracer.test.ts
npx vitest run tests/daily-hours-concurrency.int.test.ts
```

Expected: transport outcomes are parity-covered and the concurrency test passes against migrated disposable PostgreSQL rather than skipping.

## STOP conditions

- A provider cannot implement the narrow port without weakening RLS/SQL authorization or splitting an existing atomic write.
- Current action or v1 behavior contradicts the architecture's “web-canonical” rule and product intent cannot be inferred from tests.
