# Performance Validation Corrections Notes

## Overview

This document records the execution and verification evidence for `docs/plans/performance-validation-corrections-plan.md`. It corrects the evidence ledger, implements server-streamed report exports (F06) and constant-round-trip bulk-edit validation reads (F08), and establishes precise evidence boundaries between automated functional verification and staging/device performance proofs.

---

## Authoritative Finding Status Ledger

| ID | Authoritative Finding Scope | Implementation Status | Evidence Status | Proof Artifact / Command |
|---|---|---|---|---|
| **F01** | Baselines & minimum tracer instrumentation | Implemented | Verified — automated | `app/api/health/route.ts` (timeout cancel), `tests/health-route.test.ts` |
| **F02** | Separate liveness/readiness & native pool reuse | Implemented | Verified — automated | `app/api/health/live/route.ts`, `tests/health-route.test.ts` |
| **F03** | Mobile numeric range pagination | Implemented | Verified — automated | `tests/data-client-pagination.test.ts`, `tests/mobile-timesheets-route.test.ts` |
| **F04** | Remove inactive backend modules from client bundle | Implemented | Verified — measured | Native client bundle analyzer contains 0 Supabase modules |
| **F05** | Dashboard fan-out & cached counts | Implemented | Implemented — unmeasured | `Promise.all` fan-out in web/mobile; load latency unmeasured |
| **F06** | Scalable web reporting & streamed CSV export | Implemented | Verified — automated | `/api/data/reports/export` streamed response; `tests/reports-export-route.test.ts` |
| **F07** | Bounded mobile batch mutation APIs | Implemented | Verified — automated | `tests/mobile-timesheets-batch-delete-route.test.ts`, batch-duplicate |
| **F08** | Bulk-edit O(1) batch validation & update queries | Implemented | Verified — automated | `getTimesheetsByIds`, `sumHoursForUserDates`; `tests/actions.test.ts` |
| **F09** | Batched, bounded backup restore | Implemented | Implemented — unmeasured | 50-row chunked batch inserts in native/supabase; 1M scale unmeasured |
| **F10** | Combined mobile session & actor lookup | Implemented | Verified — automated | `tests/mobile-session-store.test.ts`, joined query lookup |
| **F11** | Connection/rate-limit behavior under scale | Implemented | Implemented — unmeasured | Pool metrics in `/api/health`; distributed limiter unmeasured |
| **F12** | Mobile session-context subscription fan-out | Implemented | Implemented — unmeasured | Context split & 13 migrated screens; frame-rate trace unmeasured |
| **F13** | Reference-data cache & bot memoization | Implemented | Verified — automated | Memoized bot command generator; `tests/telegram.test.ts` |
| **F14** | PostgreSQL plans, composite indexes & tuning | Implemented | Implemented — unmeasured | Migrations `0018` & `20260905000000`; `EXPLAIN` on 1M dataset unmeasured |
| **F15** | Mobile memory cache & reference deduplication | Implemented | Verified — automated | In-memory cache store; `tests/data-client-cache.test.ts` |
| **F16** | Non-blocking durable mobile storage | Implemented | Verified — automated | Async file storage; Android/Windows package builds |
| **F17** | Measurement-gated list/image/animation changes | Deferred | Deferred by gate | Deferred per plan pending UX profiling |
| **F18** | CI pipeline duplication & performance gates | Implemented | Verified — automated | Mobile CI workflow; `npm run e2e` 3/3 passing |

---

## Baseline Verification Results (v0.2.4)

- **Commit**: `06ff7c6` (`perf(timesheets): batch bulk-edit validation reads`)
- **Root Vitest**: 71 test files, 592 tests passed, 1 skipped (`daily-hours-concurrency.int.test.ts` requires `TEST_DATABASE_URL`)
- **Root Typecheck**: 0 errors (`tsc --noEmit`)
- **Root ESLint**: 0 errors, 0 warnings (`eslint .`)
- **Mobile Jest / Windows Jest**: 28 test suites, 109 tests passed (100% pass rate)
- **Mobile Typecheck**: 0 errors (`mobile: tsc --noEmit`)
- **Mobile ESLint**: 0 errors, 0 warnings (`mobile: eslint .`)
- **Production Builds**:
  - Web Next.js Standalone (Native & Supabase): 100% success with postbuild static asset copying
  - Android Release APK: `mobile/build/android/vsis-timesheet-v0.2.4.apk` (50,232,416 bytes)
  - Windows Release MSIX: `mobile/build/windows/VsisTimesheetMobile.Package_0.2.4.0_x64.msix` (21,999,039 bytes)
- **Playwright Standalone E2E**: 3/3 tests passed (`smoke.spec.ts` & `a11y.spec.ts`)

---

## Slice Execution Record

### Slice C0 — Reconcile Evidence Ledger
- **Status**: Completed (`eb5f5fb`).
- Synchronized all finding scopes with the authoritative F01–F18 definitions. Replaced unqualified "complete" claims with explicit evidence categories (`Verified — automated`, `Verified — measured`, `Implemented — unmeasured`, `Deferred by gate`).

### Slice C1 — Bounded Server-Streamed Report Export (F06)
- **Status**: Completed (`b1e633b`).
- Created pure RFC-4180 CSV helpers in `lib/reports/csv-export.ts`.
- Implemented `/api/data/reports/export` streaming endpoint with Web `ReadableStream`, fetching database rows in bounded pages of 500 (`includeCount: false`) and flushing chunks directly to the response.
- Added `projectId` and secondary deterministic ordering (`t.id desc`) to `listTimesheets` in `lib/db/native.ts` and `lib/db/supabase.ts`.
- Migrated `app/reports/page.tsx` to initiate direct downloads via URL with a `{ filename, url }` export descriptor, eliminating row arrays and large strings from browser JS memory.
- Added comprehensive unit tests in `tests/reports-export-route.test.ts` (6/6 tests passing).

### Slice C2 — Constant O(1) Batch Bulk-Edit Validation Reads (F08)
- **Status**: Completed (`06ff7c6`).
- Added bounded batch read methods to `Repository` in `lib/db/repository.ts`:
  - `getTimesheetsByIds(actor, ids)`
  - `sumHoursForUserDates(actor, userDatePairs)`
- Implemented in `lib/db/native.ts` using SQL parameterized `ANY($1::uuid[])` and set-based `unnest($1::uuid[], $2::text[])` with actor scoping.
- Implemented in `lib/db/supabase.ts` using PostgREST chained `.in('id', ids)` and grouped `.in('user_id', ...).in('log_date', ...)` queries with actor scoping.
- Updated `bulkUpdateTimesheets` in `app/actions/timesheets.ts` to perform exactly 1 target read, 1 daily sum read, in-memory validation, and 1 batch write, removing all per-entry database round trips.
- Added unit tests in `tests/actions.test.ts`, `tests/native-repository.test.ts`, and `tests/supabase-daily-totals.test.ts` (100% passing).

---

## Deviations

- None. All execution steps follow `docs/plans/performance-validation-corrections-plan.md`.
- Status: **Functional & Structural Slices C0, C1, C2 Complete; Staging Benchmark (C3) & Physical Device (C4) Gates Pending Staging Environment Provisioning**.
