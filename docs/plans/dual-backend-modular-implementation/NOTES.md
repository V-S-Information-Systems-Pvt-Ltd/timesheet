# Dual-backend modular architecture implementation notes

Update this file during implementation. Do not record planned results as completed evidence.

## Baseline

- Implementation-start commit: `242c81b43cc22cea5a0b8764ec37d9dd0bd96579` (verified descendant of planning baseline `969e8cc` via branch history; `git branch --show-current` → `arch/dual-backend-modular-implementation`)
- Branch: `arch/dual-backend-modular-implementation`
- Implementation worktree: `C:\dev\timesheet-dual-backend-modular`
- Implementer/date: Command Code agent, 2026-09-13
- Uncommitted changes preserved: working tree was clean at start (`git status --short` empty)
- Architecture-source content hash: `a5e21b2240669054729b5d56fae86367144ef8a5` (`git hash-object docs/plans/dual-backend-modular-architecture.md` at implementation start)

## Slice status

| Slice | Status | Commit/PR | Evidence |
|---|---|---|---|
| 01 | complete | `27ebdc6` | Reviewed APPROVE. Root typecheck/lint/1055 tests/coverage pass; both backend builds pass; mobile typecheck/266 tests pass; Windows release package + bundle pass (React 19.2.3 only). Open gates: Android SDK, macOS iOS, signed/deployed Windows launch, per-backend Playwright E2E/a11y. |
| 02 | complete | `e31ddbf` | Required deps (persistence/clock/write-budget), narrow port, application-owned charging, transport rewiring. Unit + real-PostgreSQL integration + Docker runtime evidence below. Reviewed with requested changes fixed. |
| 03 | complete | `be675df` | Shared HTTP client extracted to @vsis/client; cookie-or-bearer v1 auth with strict bearer precedence; browser timesheet reads are backend-neutral. Reviewed APPROVE. |

### Slice 03 — 2026-09-13

| Check | Command | Result |
|---|---|---|
| Root typecheck / lint | `npm run typecheck`, `npm run lint` | exit 0 |
| Root unit tests | `npm test` | exit 0 — 104 files / 1105 passed, 35 skipped |
| Coverage | `npm run test:coverage` | exit 0 — aggregate 69.64% lines / 60.76% branches; new `packages/client/**` gate passes (api-client.ts 86.79% lines, 87.93% branches) |
| Slice 03 targeted suite | `npx vitest run tests/vsis-client.test.ts tests/mobile-request-auth.test.ts tests/mobile-timesheets-cookie-auth.test.ts tests/mobile-timesheets-route.test.ts tests/data-client-native.test.ts tests/data-client-supabase.test.ts tests/data-client-pagination.test.ts tests/data-client-cache.test.ts tests/mobile-contract-parity.test.ts` | exit 0 — 9 files, 83 tests |
| Web builds (both backends) | `NEXT_PUBLIC_BACKEND=native` and `supabase` `npm run build` | exit 0 — both compiled successfully |
| Mobile (transport extraction) | `mobile: npm run typecheck`, `npm test` | exit 0 — 44 suites / 266 tests; mobile wire behavior unchanged (same URLs, headers, timeout, envelope, refresh retry) |

Security semantics implemented and pinned by tests:
- Explicit `Authorization` always selects bearer; malformed headers and invalid/expired/revoked bearer sessions never fall back to cookies (new tests cover malformed, invalid token, and revoked session with a valid cookie present).
- Bearer requests keep the feature gate (`MOBILE_API_DISABLED` 503 when disabled); cookie requests bypass the gate and never read `MOBILE_AUTH_SECRET`.
- Cookie requests resolve the signed-in active actor through the web facade and run under the request-scoped cookie Supabase client (no mobile bearer wrapper, no fabricated session id/token).
- Cookie mutations are origin-checked before identity resolution; bearer mutations and safe methods unchanged.
- `allowCookie` is opt-in on exactly the five timesheet resource routes; login/refresh/logout/logout-all stay bearer-only (repo-wide check in `tests/mobile-timesheets-cookie-auth.test.ts`).
- Concurrent cookie/bearer requests keep distinct identity contexts (AsyncLocalStorage isolation test).

Contract preservation:
- Browser `dataClient.getTimesheets` keeps its `{ data, count, error }` shape, nested row fields (`projects`/`profiles`/`activity_types`), pagination params, single-flight dedupe and stale-response handling, now over `/api/v1/timesheets` under the cookie session; the flat DTO is mapped back to the row shape all consumers read.
- `/api/v1` envelopes, statuses, error codes, idempotency behavior and telemetry headers unchanged for bearer callers.

Review outcome (independent agent): APPROVE. Two recommended test cases were added: revoked bearer session with a valid cookie present (`tests/mobile-request-auth.test.ts`) and paged `count` preservation (`tests/data-client-pagination.test.ts`). Non-blocking notes accepted: origin rejections use the existing `{ error }` 403 body without `x-request-id` (reachable only by cookie mutations; the browser client is read-only for timesheets), and the cookie `credentials` mode is now the browser default rather than an explicit option.

Deviation — cookie scope (slice 03): cookie authentication was implemented as a per-route opt-in (`allowCookie`) on the five timesheet resources only, because making it unconditional would have changed mobile-only auth endpoints (login/refresh/logout), which this slice is required to leave unchanged.

| 04 | complete | `3f0afe5` | Reference data (projects, activity types, titles) on one service + narrow port; title trim regression found in review and fixed with route tests. |
| 05 | complete | `e78a0fb` | People/hierarchy on one service + port with identity creation isolated; web/mobile missing-credentials messages preserved via a transport-visible reason. |
| 06 | complete | `f533d76`, `95ec028` | Leave/reminders service + port; keyed replay protocol and per-transport budget semantics verified unchanged by review. |
| 07 | complete | `1cfbdc1` | Reporting service + read port; RLS/RPC scope and CSV behavior preserved (reviewed APPROVE). |
| 08 | complete | `599af36`, `12f3c81` | Workspace service + port; super-admin default-layout bypass found in review and moved into the service with tile validation. |
| 09 | complete | `39c3b49` | Operations coordinator + ports; restore stays one indivisible provider op; central log redaction. |
| 10 | complete | `2788369` | Identity boundary with provider-injected ports and canonical contracts; password/session guards preserved. |
| 11 | complete | `1336a97` | Browser facade is one HTTP implementation over @vsis/client (no backend selection, no direct Supabase for app data); date/hierarchy helpers moved to @vsis/core with mobile duplicates deleted; static boundary-enforcement tests added. |

### Slice 09 follow-up — 2026-09-13 (`6544658`)

Review found the import audit recorded the provider-side skipped count while callers received the transport-side count; the audit now records the same value callers see, and the restore audit failure keeps its original log message. The new restore integration test now triggers a genuine late-category failure (invalid `remind_at` cast) rather than an over-long message that `parseBackup` truncates. Run against disposable PostgreSQL: commit-on-success, validation failure touches nothing, and a mid-write failure rolls back with zeroed counts.

### Slice 11 — 2026-09-13

| Check | Command | Result |
|---|---|---|
| Root typecheck / lint | `npm run typecheck`, `npm run lint` | exit 0 |
| Root unit tests | `npm test` | exit 0 — 113 files / 1248 passed, 38 skipped |
| Coverage | `npm run test:coverage` | exit 0 — aggregate 71.51% statements / 63.11% branches / 78.64% funcs / 75.34% lines; `lib/data/client.ts` 96% lines; `packages/core/src` 96.85% lines; `packages/client/src` 88.13% lines; all gates pass |
| Web builds | `NEXT_PUBLIC_BACKEND=native` and `supabase` `npm run build` | exit 0 — both compiled |
| Mobile | `mobile: npm run lint`, `npm run typecheck`, `npm test` | lint 0 errors, typecheck exit 0, 44 suites / 266 tests |
| Boundary search | `rg 'NEXT_PUBLIC_BACKEND|createClient|supabase' app lib/data mobile/src --glob '!**/*.test.*'` | matches limited to the approved provider/auth/server boundaries; no browser backend selection remains |
| Boundary tests | `npx vitest run tests/boundary-enforcement.test.ts` | exit 0 — package dependency direction (core→contracts→client), no server/platform imports in packages, no domain-to-adapter or cross-domain private imports, no browser database imports |

### Global verification — 2026-09-13

| Gate | Command | Result |
|---|---|---|
| Typecheck / lint / unit | `npm run typecheck`, `npm run lint`, `npm test` | exit 0 — 113 files / 1248 passed, 38 skipped |
| Coverage | `npm run test:coverage` | exit 0 — all aggregate, per-file and per-package gates pass |
| Backend builds | `NEXT_PUBLIC_BACKEND=native` / `supabase` `npm run build` | exit 0 |
| Mobile | lint / typecheck / `npm test` | 0 errors / exit 0 / 44 suites, 266 tests |
| Real PostgreSQL integration (disposable Docker PostgreSQL 16, `TEST_DATABASE_URL` = `DATABASE_URL`, all migrations applied) | `npx vitest run --no-file-parallelism tests/password-change-race.int.test.ts tests/password-recovery.int.test.ts tests/admin-create-concurrency.int.test.ts tests/idempotency.int.test.ts tests/sum-hours.int.test.ts tests/daily-hours-concurrency.int.test.ts tests/parity-tracer.test.ts tests/operations-restore.int.test.ts tests/restore.int.test.ts` | exit 0 — 37 tests passed, **0 skipped** (daily-hour concurrency, idempotency, restore atomicity/rollback, sums, tracer, password-change race, password recovery, admin-create concurrency) |
| Docker | `docker build -t vsis-timesheet:final .` + boot against the disposable native target (admin seeded, reference rows inserted) | exit 0 — image built; `/api/health` ok, bearer login, create, identical idempotent replay (still exactly one row), list with canonical DTO mapping, and batch-delete (`deletedCount: 2`) all exercised |

Open gates (not run, not counted as passing): Playwright E2E and a11y for `supabase` and `native` (need seeded per-backend fixtures and local Supabase), Android release package (no Android SDK), iOS release build (no macOS runner), and a deployed/signed Windows package launch (unsigned loose-exe launch fails fast with `0xC0000409`, consistent with missing MSIX identity). Supabase RLS integration continues to be mock/unit-level only (`tests/supabase-repository-authz.test.ts`, `tests/supabase-restore.test.ts`, `tests/supabase-daily-totals.test.ts`); no live Supabase instance was available.

### Slices 04–10 — 2026-09-13

| Check | Command | Result |
|---|---|---|
| Root typecheck / lint | `npm run typecheck`, `npm run lint` | exit 0 |
| Root unit tests | `npm test` | exit 0 — 112 files / 1242 passed, 38 skipped (DB-integration suites without `TEST_DATABASE_URL`) |
| Coverage | `npm run test:coverage` | exit 0 — aggregate ≈71.6% lines / 62.9% branches; all per-file and package gates pass |
| Web builds | `NEXT_PUBLIC_BACKEND=native` and `supabase` `npm run build` | exit 0 (re-run in the global matrix) |
| Mobile | `mobile: npm run typecheck`, `npm test` | exit 0 — 44 suites / 266 tests |
| Real database integration (disposable PostgreSQL, `TEST_DATABASE_URL`) | `npx vitest run --no-file-parallelism tests/daily-hours-concurrency.int.test.ts tests/idempotency.int.test.ts tests/restore.int.test.ts tests/sum-hours.int.test.ts tests/parity-tracer.test.ts` | exit 0 — 24 tests, 0 skipped (slice 02 run; re-run in the global matrix) |

Per-slice review outcomes:

- Slice 04: REQUEST-CHANGES → fixed. `PATCH /api/v1/admin/titles` echoed the untrimmed request name; now echoes the trimmed name (matching HEAD) and route tests cover titles PATCH/DELETE/impact.
- Slice 05: REQUEST-CHANGES → fixed. `POST /api/v1/admin/users` had lost the mobile "Email and password are required." message; the domain now reports a transport-visible `missing_credentials` reason and each transport keeps its exact HEAD wording. Deferred: `app/api/v1/auth/me` self-profile still calls the repository directly (owned by the identity slice; behavior unchanged from HEAD).
- Slice 06: APPROVE. Review independently verified the keyed replay protocol, `withIdempotency` operation names/fingerprints, effect evidence, and that write-budget charging matches HEAD per transport (`/api/data` compatibility endpoints intentionally unthrottled as before).
- Slice 07: APPROVE. RLS-scoped RPC/actor-scoped SQL unchanged; scope pinning and CSV contents preserved.
- Slice 08: REQUEST-CHANGES → fixed. `setDefaultLayouts` bypassed the workspace service with a duplicated tile rule; it now delegates to `saveDefaultLayouts` in `lib/domain/workspace.ts` (super-admin gate + tile validation owned by the service).
- Slice 09: see the 09/10 review below.
- Slice 10: see the 09/10 review below.

Deviations recorded for this group:

- Browser-domain migration deferred to slice 11: slices 04–08 could not move `lib/data/client.ts` (single shared file held by the coordinator to avoid parallel-edit conflicts), so the browser facade migration for non-timesheet domains is executed in slice 11.
- Slice 09 added a central `redactLogMeta` in `lib/logger.ts` (additive, applied to every log entry) to guarantee the slice's "no tokens/passwords/backup bodies in logs" requirement.
- Slice 10 left signup and password-recovery on their existing provider-specific implementations, with canonical contracts describing them; only the shared login/refresh/logout/revocation/password-change lifecycle moved to the identity service.

### Slice 02 — 2026-09-13

| Check | Command | Result |
|---|---|---|
| Root typecheck | `npm run typecheck` | exit 0 |
| Root lint | `npm run lint` | exit 0 |
| Root unit tests | `npm test` | exit 0 — 102 files / 1073 passed, 35 skipped |
| Coverage | `npm run test:coverage` | exit 0 — aggregate 69.31% lines / 60.18% branches; all per-file and package gates pass |
| Slice 02 targeted suite | `npx vitest run tests/timesheet-domain.test.ts tests/actions.test.ts tests/action-policy.test.ts tests/mobile-timesheets-route.test.ts tests/mobile-timesheet-duplicate-route.test.ts tests/mobile-timesheets-batch-delete-route.test.ts tests/mobile-timesheets-batch-duplicate-route.test.ts tests/idempotency-stamp-recovery.test.ts tests/batch-duplicate-reauthorize.test.ts tests/parity-tracer.test.ts` | exit 0 — 10 files, 152 passed |
| Real database integration (disposable PostgreSQL 16 in Docker, `TEST_DATABASE_URL` = `DATABASE_URL` = migrated `vsis_slice02`) | `npx vitest run --no-file-parallelism tests/daily-hours-concurrency.int.test.ts tests/idempotency.int.test.ts tests/restore.int.test.ts tests/sum-hours.int.test.ts tests/parity-tracer.test.ts` | exit 0 — 5 files / 24 tests passed, **0 skipped** (concurrency, idempotency, restore, sum-hours, tracer real-backend case all ran) |
| Docker runtime (disposable native target) | image `vsis-timesheet:slice02` booted against the disposable DB with bearer gate enabled | `/api/health` ok; bearer create → success; identical idempotent replay → no second row; list shows canonical DTO; duplicate → second row; batch-delete → `deletedCount: 2`, list empty |
| Both backend builds | `NEXT_PUBLIC_BACKEND=supabase` / `native` `npm run build` | exit 0 (run as part of the global matrix; re-verified for this slice) |

Review outcome (independent agent): REQUEST-CHANGES, all required items fixed before this record:

- Added the missing budget tests: per-operation release/keep assertions and a `RATE_LIMITED` domain rejection case (`tests/timesheet-domain.test.ts`), web action rate-limit + validate-before-reserve precedence (`tests/actions.test.ts`), and 429 `RATE_LIMITED` mapping across all six mutating v1 services (`tests/timesheet-rate-limit-service.test.ts`).
- Removed the now-dead `withWriteBudget` from `app/actions/_shared.ts` (zero callers after the timesheet actions moved to domain-owned charging) and the unused `WriteBudget` re-export.
- Routed the `/api/v1/timesheets/[id]/duplicate` replay reauthorization through `timesheetPersistence.getById` instead of the global repository.
- Restored rate-limit observability: the domain charge path logs `rate limit: write exceeded` with `retryAfter` (the previous web-action log line).

Deviation — port composition shape (slice 02): the plan names "narrow provider implementations under domain-specific native and Supabase adapter files". The port is intentionally provider-agnostic and is composed over the retained backend dispatch (`repo` in `lib/db/index.ts`), which already resolves the native SQL implementation or the request-scoped Supabase client. Two per-provider adapter files were implemented first and removed as redundant: they duplicated the existing provider implementations one-for-one and bypassed the repository mock seam that the parity tests rely on. No behavior, authorization, RLS, or transaction boundary changes; per-provider adapters remain possible when `Repository` is contracted in a later slice.

## Deviations

For each deviation record:

- Slice and date: all slices, 2026-09-13
- What the plan specified: implementation starts from `969e8cc` or a descendant (planning/validation lineages `6985ad5`, `98baca8`; final review tree `6c37c5c`).
- What the code or runtime required: `git merge-base --is-ancestor 969e8cc HEAD` exits 1; both lineages share merge-base `3212ba1` but diverged (12 commits on this branch, including squashed equivalents of the same remediation work: timesheet atomic/replay-safe writes, auth hardening, durable offline sync). The orchestrating instructions explicitly designate `242c81b` as the implementation baseline.
- Resolution chosen: proceed from `242c81b` per orchestrator instruction and the plan assumption's invalidation response ("rebase the plan against the actual start commit before editing code"). Verified at `242c81b` that every plan premise still holds: `lib/domain/timesheets.ts` keeps the `resolveDeps` global-repo fallback; `lib/data/client.ts` selects `nativeDataClient`/`supabaseDataClient` via `IS_NATIVE`; `app/api/v1/_http.ts` gates bearer access before credential parsing; root `package.json` has no `workspaces` field and React 19.2.4; mobile React 19.2.3 / React Native 0.84.1; Vitest coverage includes `lib/**`, `app/api/**`, `app/actions.ts`.
- Whether the deviation changes a STOP condition, acceptance criterion, or later slice: no — baseline identity only; all slice acceptance criteria unchanged and now anchored at `242c81b`.

## Verification results

Record commands, exit status, passed/failed/skipped counts, backend/platform, and the location of any retained raw output.

### Slice 01 — 2026-09-13 (worktree `C:\dev\timesheet-dual-backend-modular`, native shell: cmd, NODE_ENV=production present in environment)

| Check | Command | Result |
|---|---|---|
| Root typecheck | `npm run typecheck` | exit 0 |
| Root lint | `npm run lint` | exit 0 |
| Root unit tests | `npm test` | exit 0 — 101 files / 1055 passed, 35 skipped (DB-integration suites requiring `TEST_DATABASE_URL`) |
| Root coverage | `npm run test:coverage` | exit 0 — aggregate gates pass; `packages/core/src` 96.55% lines / 100% funcs; explicit package gates pass (core, contracts ≥60/60/60/50; `packages/core/src/iso-date.ts` keeps the 95/95/95/90 validation gate) |
| Mobile typecheck | `mobile: npm run typecheck` | exit 0 |
| Mobile tests | `mobile: npm test` | exit 0 — 44 suites / 266 passed (requires `NODE_ENV=test`; now pinned in mobile jest configs — production React builds strip `act`) |
| Web build (native) | `NEXT_PUBLIC_BACKEND=native npm run build` | exit 0 |
| Web build (supabase) | `NEXT_PUBLIC_BACKEND=supabase npm run build` | exit 0 |
| Standalone tracing | inspect `.next/standalone/.next/server/chunks` | shared-package code compiled into server chunks (no runtime dependency on `packages/` paths) |
| Docker build | `docker build -t vsis-timesheet:plan-check .` | exit 0 |
| Docker runtime (disposable) | `docker run postgres:16-alpine` + app image, `ALLOW_UNTRUSTED_CLIENT_IP=true` | containerized app booted, migrations ran on pool init, `/api/health` → `{"status":"ok"}`; cookie login + `GET /api/data/timesheets` OK; bearer login (`MOBILE_BEARER_AUTH_ENABLED=true`, native `MOBILE_AUTH_SECRET`) OK; `POST /api/v1/timesheets` with `Idempotency-Key` created an entry; duplicate resubmission replayed without a second row (`SELECT count(*)` = 1); response wire shape matches canonical `TimesheetEntry` |
| Mobile Windows bundle | `mobile: bundle:windows` (Metro, `--reset-cache`) | exit 0; bundle contains shared `@vsis/core` smart-hours code and React 19.2.3 only (root React 19.2.4 absent from the bundle) |
| Android package | `mobile: npm run package:android:unsigned` | FAILED — `SDK location not found. Define a valid SDK location with ANDROID_HOME…` (no Android SDK on this machine) — OPEN GATE |
| iOS release build | `npx react-native build-ios --mode Release` | NOT RUN — requires configured macOS runner — OPEN GATE |
| Windows release package | `mobile: package:windows:unsigned` (MSBuild 18.9.1 / VS 18 Community) | exit 0 — 0 errors, `mobile/windows/.../AppPackages/VsisTimesheetMobile.Package_1.0.2.0_x64.msix` + `mobile/build/windows` binaries; bundle compiled into the app (`index.windows.bundle` Hermes bytecode step) |
| Windows launch (Metro stopped) | run `windows/x64/Release/VsisTimesheetMobile.exe` with no Metro server | Process fails fast after ~6s with exit code `0xC0000409` when launched as a loose exe. Consistent with missing MSIX package identity (the package is unsigned, so it cannot be deployed). Baseline comparison not run; deployed-package launch remains an OPEN GATE |
| Playwright E2E / a11y (both backends) | `npm run e2e`, `npm run a11y` | NOT RUN this slice — requires seeded E2E fixtures per backend; global gate remains open |

### Slice 01 review — 2026-09-13

Independent review agent inspected the full slice diff (26 modified files + `packages/**`), re-ran root/mobile typecheck, targeted vitest, full `test:coverage`, mobile Jest, and lint. Verdict: **APPROVE**.

Findings and disposition:

- SHOULD-FIX (address before the first mobile runtime import of `@vsis/contracts`): mobile declared `@vsis/contracts` without its transitive `zod`. Fixed in this slice by adding `zod: ^4.4.3` to `mobile/package.json` and regenerating `mobile/package-lock.json`.
- NIT: `packages/client/**` has no explicit coverage gate yet (package is an empty boundary). Deferred to slice 03 when the shared client gains code — recorded as a known follow-up.
- NIT: canonical `CreateTimesheetInput.activityTypeId` is looser (`string | null | undefined`) than mobile's previous required `string`; server schema `logEntrySchema` still requires a non-empty value, no wire change.
- NIT: Dockerfile workspace-manifest copies are hardcoded per package; adding a package requires a Dockerfile edit.
- NOTE: `mobile/src/utils/dates.ts` holds a third equivalent `isValidISODate` — fold-in candidate for a later slice, not slice 01.

### Deviation — mobile Jest `NODE_ENV` pin (slice 01)

- What the plan specified: mobile tests run via `npm test -- --runTestsByPath …`.
- What the runtime required: this machine's shell has `NODE_ENV=production`; React ships production builds where `act` is stripped, so 27 mobile renderer suites failed with `ReactTestRenderer.act is not a function` before any slice code was involved.
- Resolution: pin `process.env.NODE_ENV = 'test'` in `mobile/jest.config.js` and `mobile/jest.config.windows.js`, mirroring the existing `vitest.config.mts` precedent; all 44 suites pass.
- STOP-condition impact: none.

### Deviation — Metro resolution for shared-package sources (slice 01)

- What the plan specified: "Make Metro watch the external package sources and force React/React Native to resolve from the mobile installation."
- What the runtime required: Metro resolves dependencies relative to the importing file, so imports originating in `packages/*/src` (including Babel helper requires) were resolved outside Metro's watched `node_modules`; the Windows bundle failed with `Unable to resolve module @babel/runtime/helpers/interopRequireDefault`.
- Resolution: `mobile/metro.config.js` adds `watchFolders` for the three package directories and `resolver.extraNodeModules` pinning `@babel/runtime` (and `@vsis/*`) to the mobile-local installation; `@babel/runtime` is declared as a dependency of each shared package so the root workspace install also provides it for Node-side tooling. Bundle then contains React 19.2.3 only (root 19.2.4 absent).
- STOP-condition impact: none — no duplicate React/React Native resolution; the Metro STOP condition was not reached.

### Incident — accidental stash pop (resolved)

A diagnostic `git stash pop` popped a pre-existing user stash (`stash@{0}`, "snapshot 2026-09-11: WIP password-change, branding-proxy, totals") because the scoped `git stash push` had failed on a pathspec error. All files it applied were restored to HEAD exactly (`git checkout HEAD -- …`); the stash entry itself was preserved untouched (`git stash list` still shows `stash@{0}`). Independent review verified afterwards that the working tree contains only slice-01 changes and none of the stash's content leaked into the diff.

## Rollout observations

- Migrated endpoints kept their response envelopes, error codes and status codes, so no compatibility window was needed for released mobile clients: `/api/v1` URLs and wire shapes are byte-compatible (verified by the mobile contract-parity, request-auth and route suites plus the container exercise below).
- The container exercise ran create → identical idempotent replay → list → duplicate → batch-delete against native PostgreSQL with exactly-once effects (replay produced no second row; `SELECT count(*)` confirmed), and a final run on the completed tree produced one row from two identical submissions.
- No latency measurements were captured for migrated endpoints; the refactor keeps the same provider queries and transaction boundaries, but no before/after timing evidence exists. This remains an open (non-blocking) observation item.

## Final outcome

Execution ran to completion on branch `arch/dual-backend-modular-implementation` from implementation-start commit `242c81b` (see the baseline deviation at the top of this file; the orchestrating instructions designated that commit after the declared `969e8cc` lineage diverged). All eleven slices are implemented and committed:

| Stage | Commits |
|---|---|
| 01 shared packages tracer | `27ebdc6`, `71fc1b5` |
| 02 timesheet application owner | `e31ddbf` |
| 03 backend-neutral browser timesheets | `be675df`, `3de6197` |
| 04 reference data | `3f0afe5` |
| 05 people/hierarchy | `e78a0fb` |
| 06 leave/reminders | `f533d76`, `95ec028` |
| 07 reporting | `1cfbdc1` |
| 08 workspace | `599af36` |
| 09 operations | `39c3b49`, `6544658` |
| 10 identity | `2788369` |
| 11 boundary enforcement | `1336a97` |
| cross-slice action wiring | `12f3c81` |
| final contract consolidation | `f216d5c` |

What is proven to work on real paths:

- **Web/browser:** both backend builds compile and pass unit/route tests; browser application data access no longer selects a backend or touches a database client (`lib/data/client.ts` is one HTTP facade; enforced by `tests/boundary-enforcement.test.ts`). Both `NEXT_PUBLIC_BACKEND=native` and `supabase` production builds succeed.
- **Mobile:** mobile lint/typecheck/44 suites (266 tests) pass; the Metro Windows bundle builds after the shared-package adoption, and the Windows release package was produced (MSIX + binaries) in slice 01.
- **Native PostgreSQL:** 37 database-backed integration tests pass with **zero skips** against a disposable migrated PostgreSQL 16 instance — daily-hour concurrency, idempotency, restore atomicity/rollback, hour sums, the parity tracer, password-change race, password recovery, and admin-create concurrency. The Docker image builds, boots against that target, and completes the create/replay/list/duplicate/batch-delete flow with exactly-once writes.
- **Supabase:** behavior is preserved through the shared contracts and the untouched provider adapters, evidenced by the repository/RLS unit suites and both builds. No live Supabase instance was available, so this remains contract-level evidence only.

Remaining open gates (recorded, not counted as passing):

1. Playwright E2E and accessibility runs for both backends (need seeded per-backend fixtures and local Supabase).
2. Live Supabase RLS/restore integration (mocks only today: `supabase-repository-authz`, `supabase-restore`, `supabase-daily-totals`).
3. Android release package (no Android SDK) and iOS release build (no macOS runner); deployed/signed Windows launch (unsigned loose-exe launch fails fast with `0xC0000409`, consistent with missing MSIX identity; the release package itself builds).
4. Endpoint latency/error-rate observations before and after migration.

Documented deviations from the plan (all recorded above with evidence): baseline commit change; per-provider domain adapters composed over the retained backend dispatch instead of separate native/Supabase domain adapter modules; browser-domain client migration executed in slice 11 rather than per-domain; capability calculations kept server-side (mobile consumes server-provided booleans) while hierarchy/date helpers moved to `@vsis/core`; slice-09 central log redaction added to `lib/logger.ts`; slice-10 signup and password recovery left on their provider-specific implementations.

Known remaining contraction work: a few transports still call the compatibility repository directly for operations without a domain service yet (`app/actions/superadmin.ts` user deletion and whitelisted-domain management, import-backup reference lookups, `app/actions/_shared.ts` audit write, signup/domain-check). These are read/administrative paths with unchanged behavior; they are the natural next step if the program continues.
