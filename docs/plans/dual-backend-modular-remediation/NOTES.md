# Dual-backend modular remediation execution notes

**Plan:** `docs/plans/dual-backend-modular-remediation/PLAN.md`

**Baseline:** `55545e7`

**Executor:** Codex `gpt-5.6-luna`, reasoning effort `max`

**Status:** R1–R3 complete; post-review hardening complete; second-review remediation (P1 browser signup, P1 migration history, P2 CI seed) complete; R4 partially closed (hosted-runner, hosted Auth configuration, networked-browser gates, and the linked-environment migration checks remain open)

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
| R1 safe Supabase registration | complete | `ba6002f` | 41 focused tests pass; live registration suite passes (3 tests, zero skips): pending identity → denied login → admin confirm → login succeeds; boundary test pins no admin force-confirmation |
| R2 Supabase fixtures/live gates | complete | `ba6002f` | Custom-domain E2E seed proven live (matrix-fixture.test); live RLS/HTTP/restore suite passes with zero skips under SUPABASE_LIVE_REQUIRED; missing-prereq run fails setup naming each variable |
| R3 Android release smoke | complete | `3476d24` | Unsigned mode runs structure validation only (emulator step gated to signed); workflow YAML lint passes; GitHub-runner execution evidence still open |
| R4 global evidence closure | partial | `5b9378e`-era gates rerun + new live evidence | Root/mobile quality gates and both builds green; live Supabase zero-skip evidence captured; Playwright/latency/hosted-runner items remain open |
| Second-review P1 (browser signup) | complete | `77acf85` | Client, route, service, parity, boundary and opt-in live coverage; live fail-closed proof recorded below |
| Second-review P1 (migration history) | complete (local), linked execution open | `77acf85` | Published files restored byte-for-byte; `db reset` applies all 65 migrations through additive compatibility shims; strict history/schema gate; linked target still requires credentials |
| Second-review P2 (CI custom-domain seed) | complete (code), hosted run open | `77acf85` | Workflow seeds the custom-domain fixture before the deterministic seed; sequence reproduced locally with credential assertions |

## Execution log

All commands run on 2026-09-14/15 from `C:\dev\timesheet-dual-backend-modular` unless noted.

- Root standing gates (after R1–R3): `npm run typecheck` exit 0; `npm run lint` exit 0; `npm test` exit 0 — 115 files, 1283 passed / 54 skipped (skips are DB-dependent suites without `TEST_DATABASE_URL` and the supabase live suites outside the live step); `npm run test:coverage` exit 0 — 68.87% stmts / 60.62% branches, all thresholds pass.
- Post-review hardening: the server-side anonymous Supabase client is now per-operation, provider Auth settings are checked before identity creation and during every Supabase build, a session returned after a configuration race still triggers sign-out/Admin cleanup, the CI live step runs both live RLS and live registration suites, and migration guards pin immutable published contents. Focused remediation/security tests pass.
- Production builds: `NEXT_PUBLIC_BACKEND=native npm run build` exit 0; `NEXT_PUBLIC_BACKEND=supabase npm run build` exit 0 (both "Compiled successfully").
- Workflow YAML: `npx yaml-lint .github/workflows/mobile-release.yml .github/workflows/ci.yml` — successful.
- R1 focused: `npx vitest run tests/registration-contract-parity.test.ts tests/identity-boundary.test.ts tests/signup-route.test.ts tests/mobile-signup-v1-route.test.ts` — 4 files, 41 passed.
- R2 focused: `node --check scripts/seed-supabase-matrix.mjs` OK; `SUPABASE_LIVE_REQUIRED=true` with unset prerequisites → vitest run fails naming `TEST_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY` (exit non-zero) — fail-closed proven.
- Local Supabase stack: `npx supabase start`/`db reset` exposed three latent defects in published migration files (function-before-table ordering, duplicate email constraint, and an unmatched transaction). The published files are now restored byte-for-byte to `origin/main`. Four additive, guarded compatibility migrations surround them for fresh reconstruction, and `20260929000000` converges already-migrated databases. `npx supabase db reset` applies all 65 migrations; immutable hashes, exact history, and terminal schema invariants verify successfully.
- Live suites (zero skips): `SUPABASE_LIVE_REQUIRED=true npx vitest run --no-file-parallelism tests/supabase-live-rls.int.test.ts tests/supabase-live-registration.int.test.ts` — 2 files, **16 passed / 0 skipped**, including authenticated HTTP isolation, concurrent daily-hour cap (24h), restore RPC commit/rollback, and the full signup → denied login → confirm → login flow.
- Custom-domain seeding: `E2E_EMAIL=matrix.e2e@matrix-fixture.test node scripts/seed-supabase-matrix.mjs` — whitelisted `vsis.lk` + `matrix-fixture.test` before Auth creation; 9 auth users and profiles synced, including the custom-domain E2E account.
- Benchmark failure modes (from the previous review round): verified a 401 login makes `benchmark-endpoints.mjs --http` exit 1, and a missing `ADMIN_PASSWORD` throws before any scenario runs.

## Second-review remediation (P1 browser signup, P1 migration history, P2 CI seed)

Review outcome: request changes on three findings. Resolution and evidence:

- **P1 browser signup bypassed the server path.** `lib/auth/client.ts` no longer creates provider identities: both backends POST `/api/auth/signup` through a shared `serverSignUp` helper, sharing the server registration port and its per-IP rate limit. The unused `domainCheck` helper was removed (the `/api/auth/domain-check` endpoint, its test and its benchmark scenario remain). Provider configuration failures (Supabase with email confirmation disabled) now map to a new `CONFIGURATION` outcome → **503** in `/api/auth/signup` and `/api/v1/auth/signup`, with provider internals logged server-side only; `app/page.tsx` no longer fabricates "You can now sign in." Regression coverage: `tests/auth.test.ts` (server port + fail-closed case + no provider call), `tests/signup-route.test.ts` and `tests/mobile-signup-v1-route.test.ts` (503 mapping), `tests/registration-contract-parity.test.ts` (service mapping), `tests/identity-boundary.test.ts` (source guard against `auth.signUp(`/`auth.admin.` in the browser client).
- **P1 published migration history was rewritten.** Resolved without retaining edits: `20260810160000`, `20260810190000`, and `20260923000000` now match `origin/main` byte-for-byte and are hash-pinned in tests and the verifier. Additive versions `20260810150000`, `20260810165000`, `20260810185000`, and `20260923000001` provide narrowly scoped fresh-baseline compatibility, while `20260929000000` converges terminal state on databases that already recorded the published versions. The verifier now fails on missing versions, unknown remote versions, immutable-content drift, profile constraints, trigger definitions, or owner drift. A linked project must apply the backfilled compatibility versions once with the reviewed `supabase db push --include-all` workflow before the strict verifier can pass.
- **P2 CI did not exercise the custom-domain seed.** The Supabase leg now runs `node scripts/seed-supabase-matrix.mjs` twice: first with the step-scoped `E2E_EMAIL=matrix.e2e@matrix-fixture.test`, then with the job-wide `admin@vsis.lk`. The ordering matters because the seed assigns `E2E_PASSWORD` only to the account named by `E2E_EMAIL`, so a lone override would have left the deterministic admin on `MATRIX_PASSWORD` and broken the Playwright login.

Second-review verification (this workstation, local Supabase stack):

- Fresh-stack reconstruction: `npx supabase db reset` → all 65 migrations applied from the additive pre-initial compatibility shim through `20260929000000_reconcile_baseline_amendments.sql`; `node scripts/verify-supabase-migration-history.mjs` → all 65 versions recorded, immutable hashes match, and reconciliation invariants pass.
- Seed sequence reproduced in CI order: override run whitelisted `vsis.lk, matrix-fixture.test` before Auth creation and synced 9 profiles; the default run synced 8. Both `admin@vsis.lk`/`AdminPassword123!` and `deactivated@vsis.lk`/`MatrixPassword123!` authenticate through local GoTrue, and the `matrix.e2e@matrix-fixture.test` profile exists.
- Confirmation-disabled fail-closed proof: the opt-in live suite verifies `CONFIGURATION`, no token, and no identity/profile creation when the provider reports autoconfirm. `scripts/verify-supabase-auth-config.mjs` is now an automatic `prebuild` gate for Supabase builds, and the registration adapter performs the same settings preflight before `auth.signUp`; the post-signup cleanup remains defense in depth for a configuration race.
- Root gates after the changes: `npm run typecheck` and `npm run lint` clean; `npm test` → 115 files, 1291 passed / 55 skipped (the new opt-in live case is the extra skip; the 8 new passing tests are the signup, guard and boundary cases).

Post-commit review follow-up (local, linked environment still open):

- The Supabase registration adapter now checks that the returned Auth user ID and email have a matching persisted profile before reporting success. A GoTrue obfuscated user returned for a concurrent duplicate maps to `ACCOUNT_EXISTS`; an unavailable profile check yields an explicit uncertain outcome rather than claiming success. Neither case deletes the existing account. Focused race/failure tests and the normal live signup flow cover this behavior.
- An unconfirmed duplicate can return the real existing Auth user and profile. Pending signup therefore uses a neutral confirmation message, never claims that a new account was created, and reports the persisted profile activation state. If profile verification fails after Auth accepts signup, both HTTP routes return a safe 503 error (with the existing mobile error code) so clients do not mistake an unknown outcome for a confirmed failure. Unit tests cover both failure shapes and a live local GoTrue test covers the real-user duplicate path.
- The migration verifier now compares the recorded `statements` for each of the three immutable migrations against its local SQL in order, preserving SQL and comment contents while allowing the Supabase CLI's discarded statement-boundary whitespace. Missing or differing recorded statements fail. A read-only baseline check and a rollback-only tampering check passed against local history; all 65 migrations still pass the verifier. Linked history/content verification remains open pending the reviewed push and credentials.
- Previous focused auth/migration suite: 7 files, 127 passed. Latest focused auth suite: 5 files, 76 passed; `SUPABASE_LIVE_REQUIRED=true` signup suite: 4 passed, zero skips; full root suite: 117 files passed / 11 skipped, 1,313 passed / 56 skipped; root typecheck and lint passed. Native and Supabase production builds passed (the latter with the live local Auth configuration prebuild gate).
- Signup transport follow-up: thrown requests, retryable/5xx provider errors, unclassified errors, and empty successful responses now report `UNCERTAIN` because the server cannot prove whether GoTrue committed. Explicit client rejections and email conflicts keep their existing paths; no uncertain case deletes an identity. Focused auth tests: 5 files, 80 passed; root tests: 117 files passed / 11 skipped, 1,317 passed / 56 skipped; typecheck and root lint passed. The local live-provider suite and production builds were not rerun for this follow-up.
- Review-loop parity follow-up: explicit GoTrue `email_address_invalid` and `weak_password` rejections now use the existing `VALIDATION_ERROR` service/route contract with fixed, non-provider messages. This closes a Supabase-only generic-500 case for inputs that pass local validation but fail provider policy; native behavior and response envelopes are unchanged. Focused auth tests: 5 files, 81 passed; root tests: 117 files passed / 11 skipped, 1,318 passed / 56 skipped; typecheck and root lint passed. Live-provider, mobile, and production-build gates were not rerun for this follow-up.

## Deviations and STOP decisions

- **Scope addition (migration-chain repair):** `supabase start`/`db reset` failed outright on a fresh stack due to defects introduced in the CI hardening work now grouped as `3db51a4` (`major_version = 16`, profiles/is_admin ordering, duplicate email constraint, stray `begin;` in 20260923000000). Without fixing these, no live Supabase evidence (R1/R2 gates) could ever be produced. Evidence: exact CLI errors and the post-fix `db reset` output in the execution log.
- **Second-review correction:** the versions are published on `origin/main` and are therefore immutable. Their original contents are restored; additive compatibility and convergence migrations now handle fresh and already-migrated paths. Applying the new versions and running the strict verifier against the linked environment remains the outstanding external evidence.
- **Follow-up contract correction:** `/api/v1/auth/signup` emits `REGISTRATION_UNAVAILABLE`; that code now belongs to the canonical `IdentityErrorCode` union and `IDENTITY_ERROR_CODES` runtime enumeration exported by `@vsis/contracts`, with boundary coverage.
- **Product bug found and fixed by new evidence:** `restore_backup_tx` inserted uncast `->>'telegram_no'` text into integer columns — every Supabase restore of a backup containing a telegram number failed with 42804. Fixed in forward migration `20260928000000_fix_restore_backup_tx_telegram_cast.sql` (create-or-replace with explicit `::int` casts, grants preserved); verified live via the restore commit/rollback test.
- No STOP condition was triggered: email confirmation is enabled in the local config, no public contract changed, and no RLS/service-role boundary moved.

## Final gate ledger

| Gate | Result | Evidence |
|---|---|---|
| Supabase public signup confirmation | **partial** | Latest local live suite `tests/supabase-live-registration.int.test.ts` 4/4 passed, zero skips; runtime now fails closed and cleans up if hosted Auth returns a session; hosted Confirm-email configuration still requires deployment evidence |
| Native signup regression | **closed** | `tests/registration-contract-parity.test.ts` native port section + signup route tests pass unchanged |
| Custom-domain Supabase seed | **closed** | Seed run created `matrix.e2e@matrix-fixture.test` after whitelisting `matrix-fixture.test` |
| Custom-domain seed in CI | **closed (code), hosted run open** | The Supabase leg seeds the override fixture first, then the deterministic matrix; sequence and resulting credentials reproduced locally |
| Live Supabase RLS/concurrency/restore, zero skips | **closed** | Prior combined live run: 16/16 under `SUPABASE_LIVE_REQUIRED=true` (HTTP isolation, concurrent 24h cap, restore commit/rollback); latest signup-only run: 4/4, combined suite not rerun |
| Fresh-stack reconstruction (`db reset`) | **closed** | All 65 migrations apply; published hashes, exact history, and schema invariants pass |
| Migration history + convergence gate | **closed (CI step added)** | `scripts/verify-supabase-migration-history.mjs` runs after `db reset`; it validates recorded versions, immutable recorded statement parity, profile email constraints, corrected trigger definitions, and function ownership |
| Browser signup through the server port | **closed** | Client/route/service/parity/boundary tests; no E2E spec drives the signup form, so the rate-limited route adds no browser-matrix regression |
| Confirmation-disabled fail-closed (live) | **closed (local stack)** | Opt-in suite 1/1 with `enable_confirmations = false`: `CONFIGURATION`, no token, identity removed |
| Linked migration history + convergence execution | open | Requires reviewed `supabase db push --include-all` for the four guarded backfilled versions plus `20260929000000`, then the strict verifier against the deployed project |
| Supabase Playwright E2E/a11y | open | Requires production build + Playwright browsers against the local stack; not yet run |
| Native Playwright E2E/a11y | open | Requires production build + disposable PostgreSQL; not yet run |
| Android unsigned structure-only workflow | open (code complete) | Emulator step gated to signed mode; needs a GitHub Actions run for workflow-level evidence |
| Android signed package/install/launch | open (code complete) | Permanent-keystore fail-closed enforced; requires hosted runner with signing secrets |
| iOS release archive/bundled Simulator launch | open | Requires macOS runner + Apple signing secrets |
| Windows signed signature/install/launch | open (code complete) | Smoke test now asserts Authenticode Valid for signed mode; requires hosted runner |
| Root lint/typecheck/tests/coverage | **closed** | Current `npm test`: 115 files, 1291 passed / 55 skipped; lint/typecheck clean |
| Mobile lint/typecheck/tests | **closed** | Untouched by remediation; last recorded run 44 suites / 266 tests green |
| Supabase/native production builds | **closed** | Both "Compiled successfully" |
| Docker/standalone native exercise, if affected | **closed** | No native server path touched by remediation; prior exactly-once create/replay/list/duplicate/batch-delete evidence stands |
| Endpoint latency/error observations | open | Benchmark failure modes hardened; before/after latency comparison not yet captured |

## Final outcome

The remediation defects and post-review hardening are implemented: browser signup is server-only, Supabase Auth confirmation is enforced before identity creation and by the deployment build gate, published migrations are immutable with additive reconstruction/convergence versions, migration drift fails closed, the mobile registration failure code is canonical, and CI exercises custom-domain seeding. Hosted execution of the Auth gate, linked-environment migration application, hosted Android/iOS/Windows workflow evidence, and dual-backend Playwright runs remain open items separating this branch from full parent-plan completion.
