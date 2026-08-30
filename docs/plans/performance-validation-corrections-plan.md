# Performance Validation Corrections Plan

## Context

Version 0.2.4 passes the repository's functional gates: root and mobile lint/typecheck/tests, dual-backend Next.js builds, standalone Playwright E2E, Android release packaging, and a signed Windows MSIX. It does **not** yet satisfy the full acceptance criteria in `docs/plans/performance-efficiency-improvement-plan.md`, because live load, production-scale PostgreSQL plans, distributed-capacity behavior, browser/device profiling, and iOS release evidence remain unavailable.

The current validation notes also contain three kinds of drift that must be corrected before they are used for release approval:

1. Several finding IDs are attached to work from a different original finding.
2. F06 and F08 are described more strongly than the current code proves.
3. Functional verification, structural verification, and measured performance verification are sometimes reported as equivalent.

This plan corrects the record first, then addresses the two remaining code-level acceptance mismatches, and finally defines the staging/device evidence required to move the gate from **No-Go / Incomplete** to **Go**.

Implementation deviations must be recorded in `docs/plans/performance-validation-corrections-notes.md` under `## Deviations`. The last entry must state whether the run ended with functional acceptance, full performance acceptance, or a named blocker.

## Goal

- Restore one-to-one traceability between F01-F18 and the authoritative plan.
- Remove claims that are not supported by code, tests, or retained benchmark artifacts.
- Make report export browser-memory behavior bounded with respect to row count.
- Make bulk-edit validation reads O(1) per bounded batch rather than merely concurrent O(N) reads.
- Produce reproducible staging/database/device evidence for every remaining unmeasured acceptance criterion.
- Preserve native/Supabase authorization parity, current API compatibility, and v0.2.4 behavior.

## Authoritative Finding Map

`docs/plans/performance-efficiency-improvement-plan.md` is the source of truth for IDs and titles. All status tables and release notes must use this mapping:

| ID | Authoritative scope |
|---|---|
| F01 | Reproducible baselines and minimal instrumentation |
| F02 | Separate liveness/readiness and reuse the native pool |
| F03 | Mobile numeric range pagination |
| F04 | Remove inactive backend/validation libraries from client bundles |
| F05 | Dashboard fan-out and unnecessary exact counts |
| F06 | Scalable web reporting and export |
| F07 | Bounded mobile batch mutation APIs |
| F08 | Bulk-edit N+1 validation and update queries |
| F09 | Batched, bounded backup restore |
| F10 | Combined mobile session and actor lookup |
| F11 | Connection/rate-limit behavior under horizontal scaling |
| F12 | Mobile session-context subscription fan-out |
| F13 | Reference-data cache semantics and request deduplication |
| F14 | PostgreSQL plans, indexes, projections, RLS, and counts |
| F15 | Web Client Component and optional-panel cost |
| F16 | Non-blocking, durable mobile storage and startup work |
| F17 | Measurement-gated list/image/animation changes |
| F18 | CI duplication and missing mobile/performance gates |

## Status Vocabulary

Every finding must have exactly one status:

- **Verified — automated:** behavior and acceptance threshold are proven by repeatable automated evidence.
- **Verified — measured:** before/after performance evidence meets a predeclared threshold with correctness/resource guardrails.
- **Implemented — unmeasured:** code and regression tests exist, but the motivating performance claim lacks representative measurements.
- **Deferred by measurement gate:** no implementation is justified until profiling crosses a predeclared threshold.
- **Blocked:** required environment, owner decision, or safe dataset is unavailable.
- **Failed:** measured evidence or a required gate does not meet its threshold.

“Implemented,” “unit tested,” “builds,” and “artifact exists” must never be rewritten as “performance verified.”

## Scope

### In scope

- Correct `docs/plans/performance-efficiency-improvement-notes.md` and any v0.2.4 status matrix derived from it.
- Add a bounded server export path and migrate web report downloads to it.
- Replace bulk-edit per-entry/per-day validation reads with a constant number of bounded repository reads.
- Add targeted tests and benchmark artifacts for those corrections.
- Define and execute staging load, PostgreSQL, web, CI, and mobile-device verification.
- Update CI only where needed to retain existing performance artifacts or run an explicitly scoped performance workflow.

### Out of scope

- Changing F17 list/image/animation behavior without a failing profile.
- Introducing Redis, a pooler, HPA, replicas, or a distributed limiter before the F11 capacity and ownership decisions are approved.
- Replacing the existing Repository abstraction or changing public Server Action signatures.
- Editing applied migrations.
- Adding an npm performance framework when existing Playwright, Next analyzer, PostgreSQL tooling, browser tooling, and k6 are sufficient.
- Claiming iOS verification from Windows-hosted tests or shared TypeScript unit tests.

## Execution Slices

### C0 — Reconcile the evidence ledger

**Files**

- `docs/plans/performance-efficiency-improvement-notes.md`
- `[NEW] docs/plans/performance-validation-corrections-notes.md`
- Any release/status document containing the v0.2.4 matrix, if one is later added to the repository

**Steps**

1. Replace all remapped finding labels with the authoritative F01-F18 map above.
2. Update stale counts from 556 to the current verified root result of 560 passed / 1 skipped, but record the exact commit and rerun command rather than treating this number as timeless.
3. Replace “all 18 complete” with a split decision:
   - functional/structural gate status;
   - measured performance gate status;
   - production-readiness status.
4. Correct F06 wording to state the current behavior precisely: 500-row fetches, CSV string chunks retained until Blob creation, no full raw-object accumulation, and O(output-size) browser memory.
5. Correct F08 wording to state that the write is one batch RPC/statement while target and daily-total validation reads are still O(entries + distinct user/date pairs), though concurrent.
6. Mark F16 as Android/Windows artifact-verified and cross-platform runtime profiling pending until iOS and physical/representative-device evidence exists.
7. Record F18 standalone asset synchronization and exact `npm run e2e` 3/3 evidence separately from load/performance CI evidence.
8. For every “Verified” entry, include commit, environment, command, dataset/device, raw artifact path, threshold, and result. Downgrade entries missing any load-bearing field.

**Acceptance**

- No finding ID describes work belonging to another finding.
- No status says “Verified” solely because code or a unit test exists.
- A reviewer can trace each status to an artifact or to an explicit unmeasured/blocking statement.
- The document ends with **No-Go / Incomplete against Full Performance Acceptance Criteria** until C3 and C4 pass.

**Commit boundary:** `docs(perf): reconcile performance validation evidence`

### C1 — Make report export genuinely browser-memory bounded (F06)

**Files**

- `[NEW] app/api/data/reports/export/route.ts`
- `[NEW] lib/reports/csv-export.ts` for pure row-to-CSV encoding shared by route tests
- `app/reports/page.tsx`
- `lib/csv.ts` only if pure CSV helpers need to be separated from browser download helpers
- `[NEW] tests/reports-export-route.test.ts`
- `tests/reports.test.ts`
- `e2e/smoke.spec.ts` or a focused export spec if download coverage does not fit the existing smoke test

**Approach**

1. Add an authenticated GET export route using the existing server auth/repository boundary. Accept the existing report filters (`from`, `to`, `project`, `user`) and reject invalid/unauthorized input before response streaming starts.
2. Emit `text/csv` with `Content-Disposition: attachment` through a Web `ReadableStream`. Fetch and encode at most 500 rows at a time and release each page before fetching the next.
3. Trigger the route as a browser download from `app/reports/page.tsx`; do not call `response.blob()`, build a full `Blob`, retain a full `string[]`, or hydrate raw export rows into React state.
4. Replace `lastExport` row retention with an export request descriptor (filename, filters, export kind). “Download again” must reissue the same server download request; it must never rebuild a file from the current 50-row preview.
5. Keep the existing server-side grouped summary path unchanged.
6. Preserve deterministic CSV headers, escaping, filters, and row ordering. Add a stable secondary ordering key if the current repository order is not deterministic across page boundaries.
7. Define failure semantics explicitly:
   - validation/auth/database failure before headers returns the existing JSON error contract;
   - a mid-stream dependency failure aborts the response and is logged with request ID;
   - no UI success toast is emitted until the browser starts the download;
   - point-in-time snapshot consistency under concurrent writes remains unchanged unless product owners require a transactional export.
7. Retain the current client Blob implementation only during the slice as a rollback reference; remove or clearly deprecate it once E2E and memory evidence pass.

**Verification**

- Unit/route tests: auth rejection, invalid dates, user/project filtering, CSV escaping, 0/1/500/501-row pagination, deterministic order, second-page failure, and “Download again” reissuing the original descriptor without retaining rows.
- E2E: authenticated export produces a download with the expected filename/header and fixture checksum.
- Browser profiling at 10k and 100k rows: one browser download request; no full-dataset JS array/Blob; peak application JS heap does not grow proportionally with row count. Record the predeclared heap threshold in the corrections notes before treatment measurement.
- Server profiling: response bytes/checksum correct, per-page repository calls bounded, no response-body accumulation, and errors logged once.

**Rollback:** revert the UI to the retained v0.2.4 Blob export while leaving the additive route unused. No schema rollback is required.

**Commit boundary:** `perf(reports): stream csv exports through server download route`

### C2 — Make bulk-edit validation reads O(1) per bounded batch (F08)

**Files**

- `lib/db/repository.ts`
- `lib/db/native.ts`
- `lib/db/supabase.ts`
- `app/actions/timesheets.ts`
- `tests/actions.test.ts`
- `tests/native-repository.test.ts`
- `tests/supabase-daily-totals.test.ts`
- A `.int.test.ts` database test if `TEST_DATABASE_URL` is available

**Approach**

1. Add two bounded Repository reads without changing existing public action signatures:
   - fetch all target timesheets for a bounded ID list in one repository operation;
   - fetch totals for all distinct `(user_id, log_date)` pairs in one repository operation.
2. Native implementation: parameterized set-based SQL using `ANY`/`VALUES`, with actor scope enforced in SQL.
3. Supabase implementation: one RLS-scoped request for target IDs and one bounded request for exact user/date pairs. Prefer existing PostgREST capabilities and in-process aggregation over a new RPC. Add a forward migration/RPC only if URL/query limits or RLS semantics make the no-migration approach infeasible; that condition is a STOP condition requiring dual-backend/security review.
4. Update `bulkUpdateTimesheets` to use the two batch reads, perform existing validation in memory, then call the existing single set-based native update or service-role-only Supabase RPC.
5. Preserve per-row errors, ownership checks, backfill rules, 24-hour daily limits, rate-limit charging, concurrent-delete behavior, and partial-success semantics.
6. Keep batches bounded by the existing request limit. Do not add an unbounded `IN` query.

**Verification**

- For 1, 10, and 100 entries, assert a constant call pattern: one target read, one totals read, and at most one write.
- Test repeated IDs, missing rows, mixed owners, multiple entries moving from/to the same date, multiple users, no-op/invalid rows, >24-hour rejection, partial backend failure, and concurrent deletion.
- Run native and Supabase adapter tests and compare result shapes for the same fixtures.
- With `TEST_DATABASE_URL`, capture statement count and `EXPLAIN (ANALYZE, BUFFERS)` for 1/10/100-row batches; attach latency, buffers, locks, and correctness checksum.

**Rollback:** retain the existing single batch write contract and revert only the action's validation-read path. Additive Repository methods can be removed if no other consumer exists.

**Commit boundary:** `perf(timesheets): batch bulk-edit validation reads`

### C3 — Complete staging web/API/PostgreSQL evidence

**Prerequisites**

- Dedicated native PostgreSQL benchmark database and separate Supabase staging project.
- Sanitized deterministic datasets at 10k, 100k, and 1m timesheets.
- `TEST_DATABASE_URL`, seeded role accounts, k6, and permission to enable/read relevant PostgreSQL statistics.
- Approved SLOs, connection budget, replica count, telemetry retention, and alert owner.

**Steps**

1. Create or document an idempotent benchmark seed command that records dataset checksum and cardinalities. It must refuse production URLs and require an explicit benchmark-environment marker.
2. Capture `EXPLAIN (ANALYZE, BUFFERS)` for list, count, grouped report, export page, team/session cleanup, project/date, restore duplicate checks, and F08 batch validation queries.
3. Capture `pg_stat_statements`, pool total/idle/waiting, lock waits, dead tuples, and analyze/vacuum timestamps before and after each workload.
4. Run the existing k6 scenarios against native staging and add equivalent Supabase-safe read/auth coverage where credentials and rate limits permit. Record p50/p95/p99, throughput, errors, CPU, RSS, connections, and bytes.
5. Exercise 1/10/100/500 mutation batches and 1k/10k/100k restore payloads with correctness and idempotency checks.
6. Run single-replica and approved multi-replica tests. Confirm process-local rate-limit behavior is documented as unsuitable for strict global enforcement; do not claim F11 horizontal safety until an owner-approved shared strategy or explicit single-replica constraint exists.
7. Run probe-outage, pool-saturation, restore-failure, and rollback drills.
8. Store raw outputs as CI/staging artifacts and summarize distributions—not best runs—in the corrections notes.

**Acceptance**

- Existing k6 thresholds pass (`p95 < 2000 ms`, failed request rate `< 1%`) or are replaced by approved service-specific SLOs before execution.
- No authorization/checksum regression in either backend.
- Query plans use expected indexes at representative cardinality or the finding is marked Failed/Deferred with evidence.
- Pool waiters, locks, CPU, memory, and connection counts stay within the approved capacity budget.
- F01, F05, F09, F11, F14, F15, and F18 statuses are updated from measurements, not implementation inference.

**Commit boundary:** `docs(perf): record staging performance evidence`

### C4 — Complete mobile platform evidence

**Environments**

- Android low/mid representative physical or release-profiled device.
- iOS macOS/Xcode runner and representative device/simulator where the metric is valid.
- Windows MSBuild packaging host and representative desktop hardware.

**Steps**

1. Build signed/release candidates for all three platforms and record artifact hash, size, toolchain, commit, and signing status. Artifact existence alone is not runtime proof.
2. Measure cold/warm startup, time to first interactive frame, JS evaluation, screen transitions, list scrolling, JS/UI FPS, dropped frames, peak/resident memory, network bytes, offline restart, queue durability, and reconnect flush.
3. Capture React profiles for status-only, sync-only, dashboard-only, and reference-only context updates. Verify unrelated screen consumers do not commit.
4. Verify durable token/reference/dashboard behavior after process termination, OS restart where feasible, storage failure, corrupt data, and logout on Android/iOS/Windows.
5. Record baseline distributions and predeclare budgets before deciding whether F17 changes are justified.

**Acceptance**

- Android/iOS/Windows release startup and offline flows pass approved budgets with no credential leakage or data loss.
- F12 is marked measured only when commit count/render duration improves or stays within budget.
- F16 is marked cross-platform verified only after platform-native runtime evidence exists.
- F17 remains deferred if list/image/animation profiles are within budget; otherwise create a separate optimization plan tied to the failing trace.

**Commit boundary:** `docs(mobile): record release performance evidence`

## CI and Artifact Retention

After C1 and C2 pass locally:

1. Keep existing root, mobile, dual-backend build, container, and Playwright jobs unchanged unless measured duplication justifies a change.
2. Add a manually triggered or scheduled performance workflow rather than adding long-running 1m-row/load/device work to every PR.
3. Upload analyzer output, k6 summaries, PostgreSQL plans, build timing samples, release artifact metadata, and benchmark manifests with explicit retention.
4. Fail PR CI only on stable functional/bundle thresholds. Keep noisy staging/device metrics informational until three stable runs establish variance and an approved budget.
5. Record CI wall time, billed minutes, install/cache time, and artifact size before claiming F18 efficiency improvement.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Streaming response fails after headers and leaves a partial download | Preflight auth/validation/first query; abort stream and log request ID; test second-page failure; document snapshot/partial-file semantics. |
| Export pagination duplicates/skips rows during concurrent writes | Use deterministic secondary ordering; benchmark on stable fixtures; stop for an owner decision if point-in-time export is required. |
| Supabase composite-pair query exceeds URL/PostgREST limits | Keep the 100-row bound; measure generated request size; use a reviewed SECURITY INVOKER RPC only if the simpler path fails. |
| Batch read weakens authorization | Enforce actor scope in each adapter and add mixed-owner/role parity tests. |
| Benchmark seed damages real data | Dedicated database/project, production-URL refusal, explicit environment marker, checksum, and recoverable reset procedure. |
| One fast local run is presented as improvement | Require same-environment before/after samples, at least three runs, distributions, and resource/error guardrails. |
| Cross-platform claim is inferred from shared tests | Require platform-native artifact and runtime evidence for each platform. |
| Documentation drifts again | Make the authoritative finding map and evidence vocabulary mandatory in corrections notes and release summaries. |

## STOP Conditions

Stop and report rather than improvising if:

- a server-streamed export cannot preserve current authorization/filter semantics;
- product owners require point-in-time export consistency or guaranteed no-partial-file delivery without approving asynchronous export/storage scope;
- Supabase batching requires a privileged RPC whose caller/authentication model is not approved;
- native and Supabase adapters cannot preserve identical per-row bulk-edit outcomes;
- a benchmark target might be production or lacks a recoverable dataset reset;
- staging lacks 10k/100k/1m data, k6, required PostgreSQL statistics, or approved capacity/SLO ownership;
- iOS/Windows/Android native evidence cannot be collected on an appropriate host;
- baseline variance exceeds the claimed improvement;
- implementation would edit an applied migration, expose secrets, weaken RLS/auth checks, or add an unapproved dependency.

## Full Verification Commands

Run the applicable commands after each slice and record raw outputs with commit/environment metadata:

```powershell
npm run lint
npm run typecheck
npm run test:coverage
$env:NEXT_PUBLIC_BACKEND='native'; npm run build
$env:NEXT_PUBLIC_BACKEND='supabase'; npm run build
npx next experimental-analyze --output
npm run e2e
npm run a11y
npm run db:concurrency-test
npm run load

Set-Location mobile
npm run lint
npm run typecheck
npm test
npm run test:windows
Set-Location android
.\gradlew.bat assembleRelease
```

Also run the platform-native iOS and Windows release commands on their supported build hosts; record those exact commands in the corrections notes rather than inventing them on Windows.

## Final Acceptance Criteria

The correction effort is complete only when:

1. Finding IDs, titles, statuses, counts, and claims are synchronized with code and retained evidence.
2. Exact root/mobile/dual-backend/standalone E2E gates pass on a clean commit.
3. F06 export no longer retains the complete output or complete row set in application JavaScript memory, and checksum/filter/error tests pass.
4. F08 performs a constant number of bounded reads/writes for 1/10/100 entries in both adapters with identical outcomes.
5. PostgreSQL plans and load/resource distributions exist at required staging cardinalities.
6. F11 has either proven distributed behavior or an explicit, enforced single-replica constraint and accepted risk.
7. Android, iOS, and Windows release-mode startup/render/memory/offline evidence meets approved budgets.
8. F17 has a trace-backed accept/defer decision.
9. CI retains required performance artifacts and any efficiency claim is supported by measured wall time/billed-minute evidence.
10. The final corrections-notes entry records one of: full Go; functional-only No-Go pending named evidence; or STOP condition with owner/action required.

## Rollback Strategy

- Documentation corrections are independently revertible but must never restore disproven claims.
- C1 is additive until the UI switches to the server export route; rollback reselects the v0.2.4 client export without schema changes.
- C2 adds bounded repository methods while preserving existing contracts; rollback restores the action call path and removes unused additive methods.
- Benchmark workflows and artifacts do not affect production runtime and can be disabled independently.
- No migration is planned. If C2 triggers the Supabase RPC STOP condition, write a separate dual-migration plan with forward-fix and grant/RLS tests before implementation.

## Acceptable Finish

An acceptable finish is not a document saying “all findings complete.” It is one of:

- **Go:** functional, correctness, authorization, resource, staging, and platform thresholds all pass with retained evidence;
- **Functional-only No-Go:** code gates pass, remaining performance evidence is named and owned without overstated claims; or
- **Stopped safely:** a STOP condition is documented with the exact missing decision/environment and no weakened contract was shipped.

## Plan Review

| Dimension | Score | Resolution |
|---|---:|---|
| Completeness | 5/5 | Covers documentation drift, F06/F08 behavior, failure modes, rollback, staging, CI, and all supported mobile platforms. |
| Feasibility | 5/5 | Uses existing Repository, route, Playwright, PostgreSQL, k6, and platform tooling; C0 is the tracer slice and no new dependency is assumed. |
| Scope | 5/5 | Limits runtime changes to the two disproven acceptance claims and keeps unmeasured F17/distributed infrastructure work gated. |
| Testability | 5/5 | Each slice names fixtures, query/request bounds, commands, artifacts, and finish criteria. |
| Risk | 5/5 | Streaming, authorization, pagination, partial files, benchmark safety, platform inference, and rollback risks have explicit mitigations or STOP conditions. |
| Assumptions | 5/5 | Staging, dataset, capacity, SLO, telemetry ownership, and platform-host prerequisites are explicit and invalidate full acceptance when absent. |

Review date: 2026-08-30. Load-bearing claims were checked against v0.2.4 commit `ab48b0c`, including `streamExportTimesheets`, `bulkUpdateTimesheets`, standalone postbuild asset copying, current tests, and release artifacts.
