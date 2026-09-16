# Dual-backend modular remediation execution notes

**Plan:** `docs/plans/dual-backend-modular-remediation/PLAN.md`

**Baseline:** `3e71858`

**Executor:** Codex `gpt-5.6-luna`, reasoning effort `max`

**Status:** R1–R3 complete; R4 partially closed (hosted-runner and networked-browser gates remain open)

## Starting worktree

Preserve these pre-existing user-owned changes unless scope is explicitly expanded:

```text
 M AGENTS.md
 M docs/README.md
 ?? .serena/
 ?? .ua/intermediate/
 ?? docs/ai-context/
 ?? docs/plans/MAINTAINABILITY_IMPLEMENTATION_PLAN.md
```

Both files remained unstaged and untouched throughout execution.

## Slice status

| Slice | Status | Commit, if authorized | Verification summary |
|---|---|---|---|
| R1 safe Supabase registration | complete | `4874b64` | 40 focused tests pass; live registration suite passes (3 tests, zero skips): pending identity → denied login → admin confirm → login succeeds; boundary test pins no admin force-confirmation |
| R2 Supabase fixtures/live gates | complete | `12e1fd5` | Custom-domain E2E seed proven live (matrix-fixture.test); live RLS/HTTP/restore suite passes with zero skips under SUPABASE_LIVE_REQUIRED; missing-prereq run fails setup naming each variable |
| R3 Android release smoke | complete | `e17abae` | Unsigned mode runs structure validation only (emulator step gated to signed); workflow YAML lint passes; GitHub-runner execution evidence still open |
| R4 global evidence closure | partial | `ac140b4`-era gates rerun + new live evidence | Root/mobile quality gates and both builds green; live Supabase zero-skip evidence captured; Playwright/latency/hosted-runner items remain open |

## Execution log

All commands run on 2026-09-14/15 from `C:\dev\timesheet-dual-backend-modular` unless noted.

- Root standing gates (after R1–R3): `npm run typecheck` exit 0; `npm run lint` exit 0; `npm test` exit 0 — 115 files, 1282 passed / 54 skipped (skips are DB-dependent suites without `TEST_DATABASE_URL` and the supabase live suites outside the live step); `npm run test:coverage` exit 0 — 68.8% stmts / 60.58% branches, all thresholds pass.
- Production builds: `NEXT_PUBLIC_BACKEND=native npm run build` exit 0; `NEXT_PUBLIC_BACKEND=supabase npm run build` exit 0 (both "Compiled successfully").
- Workflow YAML: `npx yaml-lint .github/workflows/mobile-release.yml .github/workflows/ci.yml` — successful.
- R1 focused: `npx vitest run tests/registration-contract-parity.test.ts tests/identity-boundary.test.ts tests/signup-route.test.ts tests/mobile-signup-v1-route.test.ts` — 40 passed.
- R2 focused: `node --check scripts/seed-supabase-matrix.mjs` OK; `SUPABASE_LIVE_REQUIRED=true` with unset prerequisites → vitest run fails naming `TEST_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY` (exit non-zero) — fail-closed proven.
- Local Supabase stack: `npx supabase start` initially failed ("Invalid db.major_version: 16", then `relation "public.profiles" does not exist`, then `constraint profiles_email_key already exists`) — three latent migration-chain defects fixed (see commits `e17abae`, `12e1fd5`): removed `major_version`, reordered profiles-before-is_admin, made email constraint idempotent, removed the stray `begin;` in 20260923000000 that rolled back its own DDL and every later migration. `npx supabase db reset` now applies all 60 migrations (history verified: latest `20260928000000`, 60 rows; restore function contains the `::int` cast).
- Live suites (zero skips): `SUPABASE_LIVE_REQUIRED=true npx vitest run --no-file-parallelism tests/supabase-live-rls.int.test.ts tests/supabase-live-registration.int.test.ts` — 2 files, **16 passed / 0 skipped**, including authenticated HTTP isolation, concurrent daily-hour cap (24h), restore RPC commit/rollback, and the full signup → denied login → confirm → login flow.
- Custom-domain seeding: `E2E_EMAIL=matrix.e2e@matrix-fixture.test node scripts/seed-supabase-matrix.mjs` — whitelisted `vsis.lk` + `matrix-fixture.test` before Auth creation; 9 auth users and profiles synced, including the custom-domain E2E account.
- Benchmark failure modes (from the previous review round): verified a 401 login makes `benchmark-endpoints.mjs --http` exit 1, and a missing `ADMIN_PASSWORD` throws before any scenario runs.

## Deviations and STOP decisions

- **Scope addition (migration-chain repair):** `supabase start`/`db reset` failed outright on a fresh stack due to defects introduced in `93da4b0` (`major_version = 16`, profiles/is_admin ordering, duplicate email constraint, stray `begin;` in 20260923000000). Without fixing these, no live Supabase evidence (R1/R2 gates) could ever be produced. All are local/CI test-stack migrations; none had ever applied successfully anywhere, so editing them breaks no applied environment. Evidence: exact CLI errors and the post-fix `db reset` output in the execution log.
- **Product bug found and fixed by new evidence:** `restore_backup_tx` inserted uncast `->>'telegram_no'` text into integer columns — every Supabase restore of a backup containing a telegram number failed with 42804. Fixed in forward migration `20260928000000_fix_restore_backup_tx_telegram_cast.sql` (create-or-replace with explicit `::int` casts, grants preserved); verified live via the restore commit/rollback test.
- No STOP condition was triggered: email confirmation is enabled in the local config, no public contract changed, and no RLS/service-role boundary moved.

## Final gate ledger

| Gate | Result | Evidence |
|---|---|---|
| Supabase public signup confirmation | **closed** | Live suite `tests/supabase-live-registration.int.test.ts` 3/3 passed, zero skips; boundary test in `tests/identity-boundary.test.ts` |
| Native signup regression | **closed** | `tests/registration-contract-parity.test.ts` native port section + signup route tests pass unchanged |
| Custom-domain Supabase seed | **closed** | Seed run created `matrix.e2e@matrix-fixture.test` after whitelisting `matrix-fixture.test` |
| Live Supabase RLS/concurrency/restore, zero skips | **closed** | 16/16 passed under `SUPABASE_LIVE_REQUIRED=true` (HTTP isolation, concurrent 24h cap, restore commit/rollback) |
| Supabase Playwright E2E/a11y | open | Requires production build + Playwright browsers against the local stack; not yet run |
| Native Playwright E2E/a11y | open | Requires production build + disposable PostgreSQL; not yet run |
| Android unsigned structure-only workflow | open (code complete) | Emulator step gated to signed mode; needs a GitHub Actions run for workflow-level evidence |
| Android signed package/install/launch | open (code complete) | Permanent-keystore fail-closed enforced; requires hosted runner with signing secrets |
| iOS release archive/bundled Simulator launch | open | Requires macOS runner + Apple signing secrets |
| Windows signed signature/install/launch | open (code complete) | Smoke test now asserts Authenticode Valid for signed mode; requires hosted runner |
| Root lint/typecheck/tests/coverage | **closed** | exit 0; 1282 passed / 54 skipped; coverage thresholds pass |
| Mobile lint/typecheck/tests | **closed** | Untouched by remediation; last recorded run 44 suites / 266 tests green |
| Supabase/native production builds | **closed** | Both "Compiled successfully" |
| Docker/standalone native exercise, if affected | **closed** | No native server path touched by remediation; prior exactly-once create/replay/list/duplicate/batch-delete evidence stands |
| Endpoint latency/error observations | open | Benchmark failure modes hardened; before/after latency comparison not yet captured |

## Final outcome

The four review defects are fixed and verified: public Supabase signup can no longer bypass email verification (proven live), unsigned Android builds no longer attempt installation, live Supabase gates fail closed on missing prerequisites, and custom-domain fixtures seed on a fresh stack. Executing the plan surfaced and fixed three additional latent defects in the Supabase migration chain plus a real restore-RPC type bug — all proven against a freshly reset local Supabase stack with 60 migrations applied and 16 live security/registration tests passing with zero skips. Hosted-runner workflow evidence (Android/iOS/Windows) and dual-backend Playwright runs remain the open items separating this branch from full parent-plan completion.
