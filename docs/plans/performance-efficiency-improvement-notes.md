# Performance and Efficiency Improvement Notes

## Deviations

*No code-forced deviations recorded as of baseline phase S0a.*

---

## Slice S0a — Baseline & Diagnostic Artifact Capture

- **Slice / commit / backend / dataset / environment:**
  - Slice: `S0a`
  - Commit: `8811db815a8ea775250d3741c5268f72dd404fd1`
  - Backends: Native PostgreSQL (`IS_NATIVE=true`) & Supabase (`IS_NATIVE=false`)
  - Dataset: Standard test suites and static build fixtures
  - Environment: Windows 11, Node.js v22.14.0, Next.js 16.3.0 (Turbopack), Vitest 4.1.11, Jest 29.7.0

- **Motivating metric and baseline distribution:**
  - Establish verifiable baseline for build times, bundle diagnostics, test runtimes, and route classifications before applying any performance changes.
  - Native Build: Turbopack compile ~426ms, TypeScript check ~1721ms, Page generation ~389ms (42/42 pages).
  - Supabase Build: Turbopack compile ~1162ms, TypeScript check ~1643ms, Page generation ~397ms (42/42 pages).
  - Vitest Root Suite: 64 test files (523 tests passed, 1 skipped) in ~1.35s – 2.08s.
  - Mobile Jest Suite: 28 test files (101 tests passed) in ~3.20s – 5.48s.
  - Bundle Diagnostics: Generated via `npx next experimental-analyze --output` under `.next/diagnostics/analyze`.

- **Pre-declared target:**
  - Complete Slice S0a baseline capture with 0 code regressions and establish truthful environment readiness per assumptions A01–A12.

- **Correctness, authorization, resource, and error-rate guardrails:**
  - Zero production application code modified in S0a.
  - All test suites passing (Vitest 523/523, Mobile Jest 101/101).
  - 100% dual-backend build success.

- **Exact commands and raw artifact paths:**
  - `NEXT_PUBLIC_BACKEND='native' npm run build`
  - `NEXT_PUBLIC_BACKEND='native' npx next experimental-analyze --output` -> `.next/diagnostics/analyze/`
  - `NEXT_PUBLIC_BACKEND='supabase' npm run build`
  - `npm test`
  - `cd mobile && npm test`
  - `cd mobile && npm run test:windows`

- **Treatment result with variance:**
  - Build times variance: Native compile 426ms–863ms; Supabase compile 1162ms–1357ms.
  - Test times variance: Vitest 1.35s–2.08s; Mobile Jest 3.20s–5.48s.
  - Analyzer reports stored in `.next/diagnostics/analyze`.

- **Decision:**
  - **Accept** (Baseline established; ready for Slice S0b and Phase 1 S1/S2 execution).

---

## Slice S2 — Mobile Range Pagination Contract Repair (F03)

- **Slice / commit / backend / dataset / environment:**
  - Slice: `S2`
  - Commit: Working tree on `mobile-dev`
  - Backends: Dual (Native / Supabase API contract parity)
  - Dataset: Mobile unit test fixtures and mocked API pagination responses (50-100 rows)
  - Environment: Windows 11, Node.js v22.14.0, Jest 29.7.0, React Native 0.84

- **Motivating metric and baseline distribution:**
  - Baseline problem: `TimesheetListParams` had no `offset` field; `ApiClient.listTimesheets` did not serialize `from`/`to` numbers; `TimesheetListScreen` load-more re-fetched page 1 and deduplicated in JS, causing redundant queries, duplicate network transfers, and stopping pagination after 25-50 items.
  - Corrected behavior: `from` and `to` are typed as numbers in `TimesheetListParams`, serialized as exact numeric query parameters when `!== undefined`, and `TimesheetListScreen` requests `from = entries.length, to = from + PAGE_SIZE - 1`.

- **Pre-declared target:**
  - Page 1 requests `from=0&to=24&limit=25`.
  - Load-more (Page 2) requests `from=25&to=49&limit=25` without duplicate page 1 requests or dropped records.
  - Zero server-side API or database contract breaks.

- **Correctness, authorization, resource, and error-rate guardrails:**
  - `TimesheetListParams` supports numeric offsets.
  - `ApiClient` serializes `from=0` correctly (does not omit falsy zero).
  - All 28 mobile Jest suites (103 tests) pass on both default and Windows configurations.
  - All root timesheet API route tests pass.

- **Exact commands and raw artifact paths:**
  - `cd mobile && npx jest --runInBand __tests__/api-client.test.ts __tests__/timesheet-list-screen.test.tsx`
  - `cd mobile && npm test`
  - `cd mobile && npm run test:windows`
  - `npx vitest run tests/mobile-timesheets-route.test.ts`

- **Treatment result with variance:**
  - Mobile Jest: 28/28 suites passed (103/103 tests, +2 regression tests added).
  - Mobile Windows Jest: 28/28 suites passed (103/103 tests).
  - Root Vitest: 6/6 tests in `tests/mobile-timesheets-route.test.ts` passed.

- **Decision:**
  - **Accept** (F03 pagination defect resolved and proven by regression tests).

---

## Slice S1 — Health & Probes Optimization (F02)

- **Slice / commit / backend / dataset / environment:**
  - Slice: `S1`
  - Commit: Working tree on `mobile-dev`
  - Backends: Dual (Native PostgreSQL / Supabase)
  - Dataset: Probe simulation test suite (`tests/health-route.test.ts`)
  - Environment: Windows 11, Node.js v22.14.0, Vitest 4.1.11

- **Motivating metric and baseline distribution:**
  - Baseline problem: `/api/health` constructed and ended a new `pg.Pool` on every single request in native mode. Both Kubernetes liveness (every 30s) and readiness (every 10s) probed the same database-dependent endpoint, causing repeated connection/TLS teardown cycles and risking restart storms during temporary DB network blips.
  - Corrected behavior: Added `/api/health/live` process-only liveness endpoint returning 200 without touching the database; updated `/api/health` readiness probe to reuse the application's shared `getPool().query('select 1')` with a 2-second timeout without calling `ensureMigrated()`; updated `deploy/deployment.yaml` to decouple liveness from readiness.

- **Pre-declared target:**
  - `/api/health/live` returns 200 without executing database queries.
  - `/api/health` reuses `getPool()` without creating or ending standalone pool instances.
  - Temporary DB downtime returns 503 on readiness without breaking process liveness.

- **Correctness, authorization, resource, and error-rate guardrails:**
  - Zero new connection pool construction per health check.
  - Both native and Supabase modes pass build, typecheck, lint, and unit tests.
  - `tests/health-route.test.ts` covers 7/7 happy and failure scenarios.

- **Exact commands and raw artifact paths:**
  - `npx vitest run tests/health-route.test.ts`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `NEXT_PUBLIC_BACKEND='native' npm run build`
  - `NEXT_PUBLIC_BACKEND='supabase' npm run build`

- **Treatment result with variance:**
  - `tests/health-route.test.ts`: 7/7 tests passed in 64ms.
  - Full Vitest suite: 65 files, 530 tests passed in 1.54s.
  - Production builds: Native compiled in 1.9s; Supabase compiled in 847ms.

- **Decision:**
  - **Accept** (F02 probe resource churn and liveness coupling resolved).

---

## Slice S0b — Instrumentation Tracer (F01)

- **Slice / commit / backend / dataset / environment:**
  - Slice: `S0b`
  - Commit: Working tree on `mobile-dev`
  - Backends: Dual (Native PostgreSQL / Supabase)
  - Dataset: Route and request auth unit tests (`tests/logger.test.ts`, `tests/mobile-request-auth.test.ts`, `tests/mobile-dashboard-route.test.ts`)
  - Environment: Windows 11, Node.js v22.14.0, Vitest 4.1.11

- **Motivating metric and baseline distribution:**
  - Baseline problem: Server logs lacked structured request correlation (`requestId`), duration metrics (`durationMs`), response headers, and route performance tracking without adding heavy external APM agents.
  - Corrected behavior: Added zero-dependency `x-request-id` propagation (extracting incoming or generating UUID), execution start timing via `performance.now()`, response headers (`x-request-id`, `x-response-time`), unhandled server error logging with extracted error messages and correlation IDs, and structured request completion logging in `/api/v1/dashboard`.

- **Pre-declared target:**
  - Response headers include valid `x-request-id` and formatted `x-response-time` (`<N>ms`).
  - Request ID is promoted to top-level in structured log entries.
  - Zero sensitive tokens or credentials logged.
  - Zero third-party telemetry package dependencies.

- **Correctness, authorization, resource, and error-rate guardrails:**
  - Full suite of 65 Vitest files (531 tests) passes.
  - Overhead per request < 0.05ms (negligible).
  - Both native and Supabase production builds succeed.

- **Exact commands and raw artifact paths:**
  - `npx vitest run tests/logger.test.ts tests/mobile-request-auth.test.ts tests/mobile-dashboard-route.test.ts`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `NEXT_PUBLIC_BACKEND='native' npm run build`
  - `NEXT_PUBLIC_BACKEND='supabase' npm run build`

- **Treatment result with variance:**
  - Targeted tests: 13/13 tests passed in 338ms.
  - Full Vitest suite: 65 files, 531 tests passed in 2.96s.
  - Production builds: Native compiled in 3.5s; Supabase compiled in 1.25s.

- **Decision:**
  - **Accept** (F01 lightweight zero-dependency correlation and timing tracer proven).

---

## Slice S3a — Dashboard Count & Mobile Parallelism Tracer (F05)

- **Slice / commit / backend / dataset / environment:**
  - Slice: `S3a`
  - Commit: Working tree on `mobile-dev`
  - Backends: Dual (Native PostgreSQL / Supabase)
  - Dataset: Dashboard route & native repository unit test fixtures (`tests/native-repository.test.ts`, `tests/mobile-dashboard-route.test.ts`)
  - Environment: Windows 11, Node.js v22.14.0, Vitest 4.1.11

- **Motivating metric and baseline distribution:**
  - Baseline problem: `/api/v1/dashboard` executed two timesheet queries in series (recent 20 rows + 7-day window rows) and each query executed an exact `select count(*)` table scan even though the dashboard only consumes row data. In native mode, this issued 4 sequential database queries per dashboard request.
  - Corrected behavior: Added `includeCount?: boolean` to `TimesheetListOptions`. Skipped exact count scans in both `nativeRepository` (SQL `select count(*)`) and `supabaseRepository` (`select(..., { count: 'exact' })`) when `includeCount: false`. Parallelized the two timesheet reads in `getDashboardService` using `Promise.all` with `includeCount: false`.

- **Pre-declared target:**
  - Database round-trips for mobile dashboard reduced from 4 sequential queries to 2 parallel row queries.
  - 100% backward compatibility preserved for pagination callers (defaulting `includeCount` to `true`).
  - Zero changes to dashboard DTO shapes or client contracts.

- **Correctness, authorization, resource, and error-rate guardrails:**
  - Unit tests verify `includeCount: false` skips count query and returns `count: 0`.
  - All 65 Vitest files (532 tests) pass.
  - Both native and Supabase production builds succeed.

- **Exact commands and raw artifact paths:**
  - `npx vitest run tests/native-repository.test.ts tests/mobile-dashboard-route.test.ts`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `NEXT_PUBLIC_BACKEND='native' npm run build`
  - `NEXT_PUBLIC_BACKEND='supabase' npm run build`

- **Treatment result with variance:**
  - Targeted tests: 29/29 tests passed in 319ms.
  - Full Vitest suite: 65 files, 532 tests passed in 1.71s.
  - Production builds: Native compiled in 1.81s; Supabase compiled in 1.07s.

- **Decision:**
  - **Accept** (F05 count removal and query parallelism tracer proven).

---

## Slice S4 — Combined Auth Lookup (F10)

- **Slice / commit / backend / dataset / environment:**
  - Slice: `S4`
  - Commit: Working tree on `mobile-dev`
  - Backends: Dual (Native PostgreSQL / Supabase)
  - Dataset: Auth gate & session store unit test suites (`tests/mobile-session-store.test.ts`, `tests/mobile-request-auth.test.ts`, `tests/mobile-me-route.test.ts`)
  - Environment: Windows 11, Node.js v22.14.0, Vitest 4.1.11

- **Motivating metric and baseline distribution:**
  - Baseline problem: Every authenticated REST v1 request performed two serialized database round-trips: `mobileSessionStore.findById` followed by `getMobileActor`.
  - Corrected behavior: Added `findSessionAndActorById` to `mobileSessionStore`, executing a single SQL `LEFT JOIN public.profiles` in Native mode and a single PostgREST embedded relation query in Supabase mode. Updated `requireMobileActor` to use the combined lookup while strictly preserving fail-closed rejection semantics for revoked/expired/rotated sessions and inactive/missing accounts.

- **Pre-declared target:**
  - 1 database round trip per protected request instead of 2.
  - 100% rejection matrix parity (expired, revoked, rotated, missing, inactive).
  - Zero changes to external API error shapes or response codes (401/403).

- **Correctness, authorization, resource, and error-rate guardrails:**
  - Unit tests verify combined session+actor retrieval and edge cases.
  - All 65 Vitest files (534 tests) pass.
  - Both native and Supabase production builds succeed.

- **Exact commands and raw artifact paths:**
  - `npx vitest run tests/mobile-session-store.test.ts tests/mobile-request-auth.test.ts tests/mobile-me-route.test.ts`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `NEXT_PUBLIC_BACKEND='native' npm run build`
  - `NEXT_PUBLIC_BACKEND='supabase' npm run build`

- **Treatment result with variance:**
  - Targeted tests: 18/18 tests passed in 240ms.
  - Full Vitest suite: 65 files, 534 tests passed in 1.69s.
  - Production builds: Native compiled in 1.44s; Supabase compiled in 946ms.

- **Decision:**
  - **Accept** (F10 combined auth lookup proven with 0 regressions).

---

## Slice S5a — Batch Delete Tracer (F07)

- **Slice / commit / backend / dataset / environment:**
  - Slice: `S5a`
  - Commit: Working tree on `mobile-dev`
  - Backends: Dual (Native PostgreSQL / Supabase)
  - Dataset: Batch delete route & mobile API client unit test suites (`tests/mobile-timesheets-batch-delete-route.test.ts`, `mobile/__tests__/api-client.test.ts`)
  - Environment: Windows 11, Node.js v22.14.0, Vitest 4.1.11, Jest 29.7.0

- **Motivating metric and baseline distribution:**
  - Baseline problem: Bulk timesheet deletion executed in a client-side sequential loop (`for (const id of ids) await deleteTimesheet(id)`), producing N network requests and N full dashboard reloads. A 10-row deletion produced 20 authenticated HTTP requests.
  - Corrected behavior: Added `POST /api/v1/timesheets/batch-delete` bounded at 100 entries with per-row result tracking, single rate-limit debit, `ApiClient.deleteTimesheets` with 404 single-item fallback, and `SessionProvider.deleteTimesheets` executing one network request and a single dashboard reload.

- **Pre-declared target:**
  - Bulk deletion network calls reduced from O(N) requests to 1 request.
  - Dashboard reloads reduced from N times to 1 time.
  - Per-item outcome tracking (success/failure reason per ID).
  - 100% backward-compatibility via single-item fallback on older servers.

- **Correctness, authorization, resource, and error-rate guardrails:**
  - Schema enforces 1 <= batch size <= 100 entries.
  - Rate limiting debited once for the entire batch.
  - Full mobile Jest suite (28 suites, 105 tests) and root Vitest suite (66 files, 538 tests) pass.
  - Dual-backend builds succeed.

- **Exact commands and raw artifact paths:**
  - `npx vitest run tests/mobile-timesheets-batch-delete-route.test.ts tests/timesheets-api.test.ts`
  - `cd mobile && npm test`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `NEXT_PUBLIC_BACKEND='native' npm run build`
  - `NEXT_PUBLIC_BACKEND='supabase' npm run build`

- **Treatment result with variance:**
  - Server tests: 13/13 tests passed in 386ms.
  - Mobile tests: 28/28 suites passed (105/105 tests) in 5.3s.
  - Full Vitest suite: 66 files, 538 tests passed in 1.75s.
  - Production builds: Native compiled in 1.91s; Supabase compiled in 914ms.

- **Decision:**
  - **Accept** (F07 batch delete tracer proven with zero regressions).

---

## Slice S5b — Batch Duplicate Tracer (F07)

- **Slice / commit / backend / dataset / environment:**
  - Slice: `S5b`
  - Commit: Working tree on `mobile-dev`
  - Backends: Dual (Native PostgreSQL / Supabase)
  - Dataset: Batch duplicate route & mobile client unit test suites (`tests/mobile-timesheets-batch-duplicate-route.test.ts`, `mobile/__tests__/api-client.test.ts`, `mobile/__tests__/timesheet-list-screen.test.tsx`)
  - Environment: Windows 11, Node.js v22.14.0, Vitest 4.1.11, Jest 29.7.0

- **Motivating metric and baseline distribution:**
  - Baseline problem: Bulk timesheet duplication executed sequentially in the UI (`for (const id of ids) await duplicateTimesheet(id)`), producing N network calls and N dashboard reloads (20 authenticated HTTP requests for 10 entries).
  - Corrected behavior: Added `POST /api/v1/timesheets/batch-duplicate` accepting `{ items: Array<{ id: string; targetDate?: string }> }` bounded to 100 entries, with per-item result tracking and running 24h daily hour checks, single rate-limit debit, `ApiClient.duplicateTimesheets` with 404 single-item fallback, and `SessionProvider.duplicateTimesheets` executing one network request and a single dashboard reload.

- **Pre-declared target:**
  - Bulk duplication network requests reduced from O(N) to 1 request.
  - Dashboard reloads reduced from N times to 1 time.
  - Per-item outcome tracking (success/entry/error per item).
  - Enforced daily 24-hour limit across multiple items targeting the same log date.
  - 100% backward-compatibility via single-item fallback on older servers.

- **Correctness, authorization, resource, and error-rate guardrails:**
  - Schema enforces 1 <= items <= 100 entries with ISO date validation on targetDate.
  - Rate limiting debited once for the entire batch.
  - Full mobile Jest suite (28 suites, 107 tests) and root Vitest suite (67 files, 542 tests) pass.
  - Dual-backend builds succeed.

- **Exact commands and raw artifact paths:**
  - `npx vitest run tests/mobile-timesheets-batch-duplicate-route.test.ts tests/timesheets-api.test.ts`
  - `cd mobile && npm test`
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `NEXT_PUBLIC_BACKEND='native' npm run build`
  - `NEXT_PUBLIC_BACKEND='supabase' npm run build`

- **Treatment result with variance:**
  - Server tests: 13/13 tests passed in 471ms.
  - Mobile tests: 28/28 suites passed (107/107 tests) in 3.8s.
  - Full Vitest suite: 67 files, 542 tests passed in 1.97s.
  - Production builds: Native compiled in 2.1s; Supabase compiled in 989ms.

- **Decision:**
  - **Accept** (F07 batch duplicate tracer proven with zero regressions).

---

## Environment Readiness & Assumptions Status (A01 - A12)

| ID | Assumption | Status | Notes |
|---|---|---|---|
| A01 | Native health checks create new pool on probe | Verified | `app/api/health/route.ts:12-27` constructs `new Pool()` on each call. |
| A02 | Mobile load-more does not send offset | Verified | `TimesheetListScreen.tsx` passes offset but `contracts.ts`/`client.ts` expects `from`/`to`. |
| A03 | Next.js experimental analyzer supported | Verified | `npx next experimental-analyze --output` writes to `.next/diagnostics/analyze`. |
| A04 | Dashboard reads sequential / exact counts | Verified | `lib/api/v1/services/dashboard.ts` issues sequential list queries with counts. |
| A05 | Separate mobile session and actor lookups | Verified | `app/api/v1/_http.ts` performs 2 sequential DB lookups per bearer request. |
| A06 | Inactive backend chunk in client bundle | Observed | `lib/auth/client.ts` and `lib/data/client.ts` import both paths statically. |
| A07 | 10k/100k/1m benchmark database dataset | Unavailable locally | Requires operational staging database; schema/index changes will use local seeded tests. |
| A08 | Telemetry vendor / APM provider | Non-blocking | S0b will use lightweight local structured request timing. |
| A09 | DB capacity & replica count budget | Unavailable locally | Local single-instance Postgres pool max=10. |
| A10 | Deployed client backward compatibility | Active constraint | All v1 API changes must remain backward-compatible. |
| A11 | Restore atomicity/resumability policy | Preserved | Preserve current transactional behavior without altering semantics. |
| A12 | 3-platform mobile storage proof | Required before S10c | Android Keystore / iOS Keychain / Windows PasswordVault. |
