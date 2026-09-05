# Master Architecture Remediation Notes

**Branch:** `codex/master-architecture-remediation`
**Baseline:** `3212ba1`
**Started:** 2026-09-06
**Status:** Core Remediation Complete

## Per-Task Execution Status

| Task ID | Description | Status | Verification & Evidence |
|---|---|---|---|
| T18.0 | Incremental contract and authorization characterization | Complete | `tests/parity-tracer.test.ts` (4/4 tests passing) |
| T17.0 | Bind mobile bearer identity to Supabase RLS | Complete | Request-scoped Supabase client & token minting in `lib/auth/supabase.ts` |
| T17.1 | Safe production proxy configuration | Complete | Proxy resolver & instrumentation in `lib/ip.ts` |
| T17.2 | Password change and session continuity | Complete | Atomic password/session update in Native (`changePasswordAndPreserveSession`) and Supabase |
| T17.3 | Enforce advertised bearer switch | Complete | Fail-closed gate with 503 response when bearer auth unsupported |
| T18.1 | Complete, scoped import totals | Complete | Deduplicated (user, date) query with completeness guarantee in `lib/db/` |
| T18.2 | Date-scoped report paging | Complete | Date-scoped client and load-more cancellation in `app/reports/page.tsx` |
| T18.3 | Same-origin branding image proxy | Complete | SSRF-safe proxy with connection pinning / loopback blocks in `lib/branding-proxy.ts` |
| T18.4 | Shared request-scoped branding getter | Complete | React cache() wrapper in `lib/branding-server.ts` |
| T19.1 | Atomic restore with truthful outcomes | Complete | Transactional restore RPC / atomic commit-or-rollback in `db/migrations/0014_restore_backup_tx.sql` & `supabase/migrations/20260906000000_restore_backup_tx.sql` |
| T19.2 | Safe offline replay across both backends | Complete | Idempotency keys, 90-day window, pause on 401/403 in `lib/idempotency.ts` & `mobile/src/sync/sync-engine.ts` |
| T20.1+T21.1 | Durable queue & native storage seam | Complete | Android/iOS/Windows native methods & JS KV store (`mobile/src/platform/kv-store/`, `offline-queue.ts`, `theme-store.ts`) |
| T21.2 | Atomic creates return their row | Complete | RETURNING / insert-select without follow-up queries in `lib/db/` and v1 admin routes |
| T22.1 | Shared timesheet rules domain service | Complete | Domain service extraction for timesheet write operations in `lib/domain/timesheets.ts` |
| CP23 | Deferred follow-up (decomposition & diagnostics) | Deferred | Post-core release |

## Implementation Gates Evidence

### 1. Root Test Suite & Coverage
- **Command:** `npm test`
  - **Result:** 90 test files passed (828 passed tests, 12 skipped integration tests requiring live disposable Postgres `TEST_DATABASE_URL`).
- **Command:** `npm run test:coverage`
  - **Result:** Met and exceeded required 60% thresholds across statements, branches, functions, and lines.

### 2. Linting & Type Checking
- **Command:** `npm run lint` & `npm run typecheck`
  - **Result:** 0 errors, clean check.
- **Command:** `npm --prefix mobile run lint` & `npx --prefix mobile tsc --noEmit`
  - **Result:** 0 errors, clean check.

### 3. Mobile Test Suite
- **Command:** `npm --prefix mobile test`
  - **Result:** 43 test suites passed (232 tests passed).

### 4. Dual-Backend Next.js Production Builds
- **Command:** `$env:NEXT_PUBLIC_BACKEND = 'supabase'; npm run build`
  - **Result:** Succeeded (Turbopack production build + standalone copy).
- **Command:** `$env:NEXT_PUBLIC_BACKEND = 'native'; npm run build`
  - **Result:** Succeeded (Turbopack production build + standalone copy).

## Commit History on `codex/master-architecture-remediation`

- `430e0d3`: `refactor(timesheets): extract shared timesheet rules into domain service (T22.1)`
- `86d09b6`: `feat(mobile): add durable queue and native key-value storage seam (T20.1, T21.1)`
- `40aa5ea`: `perf(db): return created records atomically from reference creates` (T21.2)
- `21ab21d`: `feat(replay): implement T19.1 atomic restore and T19.2 offline replay protection with idempotency keys`
- `8351c71`: `feat(reports): implement CP18 scoped import totals, report date paging, and branding proxy`
- `8690d75`: `feat(auth): implement T17.0, T17.1, T17.2, T17.3 and T18.0 parity tracer`

## Deviations

*No deviations from the master remediation plan.*
