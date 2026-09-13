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
| 02 | complete | see below | Required deps (persistence/clock/write-budget), narrow port, application-owned charging, transport rewiring. Unit + real-PostgreSQL integration + Docker runtime evidence below. Reviewed with findings fixed. |
| 03 | not started | | |
| 04 | not started | | |
| 05 | not started | | |
| 06 | not started | | |
| 07 | not started | | |
| 08 | not started | | |
| 09 | not started | | |
| 10 | not started | | |
| 11 | not started | | |

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

Record baseline and post-migration error/latency observations for migrated endpoints and any compatibility-window decisions.

## Final outcome

State whether the capability works on the real web/mobile paths and both backends, what evidence proves it, and any release gate that remains open.
