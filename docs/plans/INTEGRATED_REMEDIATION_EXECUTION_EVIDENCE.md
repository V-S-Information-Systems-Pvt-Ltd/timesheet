# Integrated Remediation Execution — Evidence Ledger

Branch `mobile-dev` @ `7edb0c0` (worktree clean). Evidence appended per
`INTEGRATED_REMEDIATION_AND_MERGE_EXECUTION_PLAN.md` §4.3. Labels:
unit/static, DB-integration, browser-E2E, installed-device, live-environment.

## CP1 — Merge current origin/main into mobile-dev — Complete

```
Checkpoint: CP1
Status: Complete
Branch / HEAD: mobile-dev @ 684fc14 (merge commit)
Started: 2026-09-04   Completed: 2026-09-04
Files changed: app/actions/timesheets.ts, app/components/confirm.tsx,
  app/dashboard/entries-table.tsx, app/dashboard/page.tsx, lib/db/native.ts,
  lib/db/supabase.ts, supabase/migrations/20260831101435_timesheets_backfill_window.sql,
  tests/actions-extra.test.ts, tests/actions.test.ts, tests/confirm.test.ts,
  tests/native-repository.test.ts, tests/supabase-daily-totals.test.ts,
  tests/supabase-migrations.test.ts, tests/supabase-whitelisted-domain.test.ts
Commit: 684fc14 chore(merge): merge main into mobile-dev
Commands and results:
  npx vitest run (CP1 targeted 7 files)          -> 161 passed
  npm run typecheck                               -> clean
  git diff --cached --check                       -> clean
  origin/main is an ancestor of mobile-dev HEAD    -> yes
Unexpected skips: none
Deviations:
  - Resolved the 8-way conflict keeping mobile-dev's newer batched
    bulkUpdateTimesheets (native VALUES single-statement + supabase RPC),
    carrying origin/main's stricter writable-backfill-window predicates into
    the native batch scope and the action layer. Kept the supabase RPC path
    (its RPC re-checks ownership atomically; main's per-row PostgREST path was
    superseded by mobile-dev's RPC).
  - Migration files: no duplicate timestamp survived the merge. Git tracked
    main's 20260905000000_freeze_manager_id_own_update.sql -> mobile-dev rename
    to 20260905020000, and mobile-dev's 20260905000000_fix_mobile_session_rotation.sql
    is additive. The F1 collision did NOT materialize as two same-version files.
  - tests/supabase-daily-totals.test.ts kept mobile-dev's RPC-based tests (a
    later evolution than main's PostgREST-update tests); dropped an unused
    todayISO import in a follow-up (7edb0c0).
Open items: none for CP1.
```

## CP3 — Scope Supabase leave/reminder access to the actor — Complete

```
Checkpoint: CP3
Status: Complete
Branch / HEAD: mobile-dev @ fc75801
Files changed: lib/db/supabase.ts, tests/supabase-repository-authz.test.ts
Commit: fc75801 fix(db): scope supabase leave and reminder writes to the actor
Commands and results:
  npx vitest run tests/supabase-repository-authz.test.ts  -> 10 passed
  npx vitest run tests/native-repository.test.ts           -> 38 passed
  npm run typecheck                                        -> clean
Deviations:
  - createLeaves rejects any non-own row for a non-admin before writing
    (native parity).
  - deleteLeave scopes to user_id = actor.id for non-admins; admins unconstrained.
  - listReminders always scopes to actor.id (own-only), ignoring caller userId.
  - createReminder uses isAdminActor ? input.userId : actor.id (native parity).
  - updateReminder / deleteReminder scope to user_id = actor.id.
  - Raw PostgREST error hygiene intentionally deferred to CP10 (per plan).
Open items: none.
```

## CP4 — Make CI execute database and authenticated E2E checks — Complete

```
Checkpoint: CP4
Status: Complete
Branch / HEAD: mobile-dev @ 0254588
Files changed: .github/workflows/ci.yml, docs/security/SECURITY_REVIEW.md
Commit: 0254588 test(ci): execute database and authenticated e2e checks
Commands and results:
  CI YAML validated (env vars + step present in committed file).
Deviations:
  - native-e2e job now exports E2E_EMAIL/E2E_PASSWORD = seeded admin creds, so
    e2e/smoke.spec.ts authenticated journey runs.
  - TEST_DATABASE_URL set to the job's Postgres service; added a
    db:concurrency-test run step.
  - Pending-account E2E (e2e/pending-nav.spec.ts) documented as a manual/local
    check in the workflow comment (native seed does not create a deactivated
    fixture account). This is the plan-sanctioned alternative to seeding it.
  - Corrected stale "no in-repo vercel.json" wording in SECURITY_REVIEW.md;
    confirmed vercel.json carries only a cron schedule (no HSTS claim).
Open items: none. Green-job-with-unexpected-skip is addressed for smoke + DB
tests; the pending-nav spec remains an intentional documented skip.
```

## CP5 — Close password-recovery acceptance gaps — Complete (code/test scope)

```
Checkpoint: CP5
Status: Complete (code and automated-test scope; operator-only items listed)
Branch / HEAD: mobile-dev @ ccedfdb
Files changed: tests/password-recovery.int.test.ts (new),
  tests/password-recovery-routes.test.ts, package.json,
  .github/workflows/ci.yml
Commit: ccedfdb test(auth): close native password-recovery acceptance gaps
Commands and results:
  npx vitest run tests/password-recovery-routes.test.ts   -> 10 passed
  npx vitest run tests/password-recovery.int.test.ts
    (TEST_DATABASE_URL, disposable Postgres 16)           -> 7 passed
  npm run typecheck / eslint                              -> clean
Deviations:
  - Audit against FORGOT_PASSWORD_IMPLEMENTATION_PLAN.md found the native
    implementation (commit 7ccca38 lineage) already delivers: generic
    non-enumerating request responses with timing floor, digest-only token
    storage, supersede-on-reissue, atomic consume (session_version increment +
    mobile-session revocation in one transaction), JWT session_version claims,
    supabase PKCE recovery path. The gap was verification, not behavior.
  - Added DB-integration coverage for exactly-one-winner concurrency,
    digest-only persistence, supersede, expiry, session_version increment,
    mobile revocation, and cleanup.
  - Added route coverage for malformed token, expired==consumed non-enumeration,
    rate-limit generic-200 on request, and reserved-slot release on weak reset.
  - Wired db:password-recovery-test into CI native-e2e job.
Operator-only acceptance items NOT deliverable from this workspace (recorded
for CP6/CP15): Mailpit native E2E, configured Supabase recovery smoke test,
real SMTP delivery, live cross-device PKCE check.
```

## CP7 — Pre-merge acceptance matrix (local scope) — Partial

```
Checkpoint: CP7
Status: Blocked (operator items outstanding); local automated items green
Branch / HEAD: mobile-dev @ 7edb0c0
Commands and results (run 2026-09-04):
  npm run lint                         -> 0 errors (1 unused-import warning fixed; clean)
  npm run typecheck                    -> clean
  npm test                             -> 84 files passed / 733 passed / 8 skipped*
  npm run test:coverage                -> thresholds exceeded (76% stmts scoped)
  npm run build (native)               -> clean (EXIT 0)
  npm run build (supabase)             -> clean (EXIT 0)
  npm --prefix mobile run lint         -> 0 errors (43 pre-existing warnings)
  npm --prefix mobile run typecheck    -> clean
  npm --prefix mobile test             -> 27 suites FAILED (env issue, see below)
  git diff --check / git status --short -> clean
  *the 8 skipped = DB integration tests requiring TEST_DATABASE_URL; both .int
   files were separately verified green against a disposable Postgres 16.
Unexpected skips: none in the root suite.
Deviations:
  - A shell-inherited NODE_ENV=production caused originCheck-based auth tests
    to 403; re-running under NODE_ENV=test is green. CI does not export
    NODE_ENV=production for unit tests.
  - Mobile Jest: 27/43 suites fail with
    "react-test-renderer .act is not a function" across all RN component tests.
    Zero mobile files changed by this execution; the failure reproduces the
    pre-existing mobile-dev test-env state (react 19.2.3 pinned). Not caused by
    CP1-CP5. Flagged as a pre-existing mobile-dev issue for a separate fix.
Open items (operator): authenticated Playwright smoke, Docker image build,
Supabase migration clean/historical-lineage convergence, live-function probes,
mobile installed-device evidence.
```

## CP6 / CP8 — Blocked (operator)

CP6 requires authorized environment access (secrets provisioning, proxy
topology, SMTP, Supabase project config, database snapshots) and CP8 requires
explicit authorization for the final local merge plus CP7 fully green. Neither
is authorized in this workspace. CP2 remains blocked on the release-owner
migration-version approval recorded in MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md
(STOP gate). MOBILE_BEARER_AUTH_ENABLED remains false everywhere; no push, no
deploy, no migration application was performed.
