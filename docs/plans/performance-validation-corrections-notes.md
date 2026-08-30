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

- **Commit**: `ab48b0c` (`chore(release): bump version to 0.2.4`)
- **Root Vitest**: 69 test files, 560 tests passed, 1 skipped (`daily-hours-concurrency.int.test.ts` requires `TEST_DATABASE_URL`)
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

## Deviations

- None. All execution steps follow `docs/plans/performance-validation-corrections-plan.md`.
- Status: **Functional & Structural Acceptance Complete; Staging Benchmark & Physical Device Gates Pending**.
