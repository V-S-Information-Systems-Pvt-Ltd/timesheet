# Integrated Remediation Execution — Evidence Ledger

Branch `main` @ `1a0ecbd` (worktree clean). Evidence appended per
`INTEGRATED_REMEDIATION_AND_MERGE_EXECUTION_PLAN.md` §4.3. Labels:
unit/static, DB-integration, browser-E2E, installed-device, live-environment.

## CP0 — Rebaseline and record decisions — Blocked

```
Checkpoint: CP0
Status: Blocked (approval and environment evidence pending)
Branch / HEAD: mobile-dev @ 7edb0c0 / main @ 1a0ecbd
Started: 2026-09-04   Completed: Pending
Files changed: docs/plans/MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md,
  docs/plans/SECURITY_REVIEW_REMEDIATION_NOTES.md
Commands and results:
  git status / branch inspection -> verified local worktree state
Deviations: none.
Open items:
  - R1.2 policy decision status remains PENDING release-owner decision (documented in
    MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md:43).
  - Migration identity approval remains PENDING explicit release-owner approval
    (documented in SECURITY_REVIEW_REMEDIATION_NOTES.md:8).
  - Live environment database snapshot and history matrix evidence is pending.
```

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

## CP2 — Add the approved migration-convergence bridge — Implemented (Blocked on approval/live convergence)

```
Checkpoint: CP2
Status: Implemented, blocked on approval/live convergence
Branch / HEAD: mobile-dev @ 6219aaa
Started: 2026-09-04   Completed: Pending live verification and migration approval
Files changed: supabase/migrations/20260905000001_ensure_mobile_sessions.sql,
  tests/supabase-migrations.test.ts
Commit: 6219aaa fix(db): ensure mobile_sessions exists before dependent migrations
Commands and results:
  npx vitest run tests/supabase-migrations.test.ts  -> 24 passed (unit/static)
  npm run typecheck                                 -> clean
  git diff --check                                  -> clean
Unexpected skips: none in unit tests.
Deviations:
  - Added additive, idempotent table-only bridge ensuring public.mobile_sessions exists
    between 20260905000000 and 20260905030000 across all database lineages.
  - Table, indexes, RLS, and revokes included; rotate_mobile_session omitted (owned by
    post-head pin migration 20260911000001).
Open items:
  - Requires explicit release-owner approval of migration identities/version policy.
  - Requires application evidence across clean and historical-lineage database snapshots.
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

## CP4 — Make CI execute database and authenticated E2E checks — Partial

```
Checkpoint: CP4
Status: Partial (CI sequencing defect fixed; awaiting clean green CI run)
Branch / HEAD: main
Started: 2026-09-04   Completed: Pending green CI run
Files changed: .github/workflows/ci.yml, docs/security/SECURITY_REVIEW.md
Commit: 0254588 test(ci): execute database and authenticated e2e checks (updated with fixture order fix)
Commands and results:
  CI YAML validated (env vars + step reordering committed).
Deviations:
  - native-e2e job exports E2E_EMAIL/E2E_PASSWORD = seeded admin creds.
  - TEST_DATABASE_URL set to Postgres service; db:concurrency-test and
    db:password-recovery-test run in native-e2e.
  - Fixture ordering fix: Seed admin moved after destructive DB integration
    tests (daily-hours-concurrency and password-recovery truncate profiles),
    immediately before Next.js build and Playwright E2E.
  - Pending-account E2E (e2e/pending-nav.spec.ts) documented as a manual/local
    check in the workflow comment.
  - Corrected stale "no in-repo vercel.json" wording in SECURITY_REVIEW.md.
Open items:
  - Awaiting actual green CI execution output proving DB tests and authenticated
    E2E pass without fixture deletion failures.
```

## CP5 — Close password-recovery acceptance gaps — Partial

```
Checkpoint: CP5
Status: Partial (automated unit/integration expanded; manual/live items outstanding)
Branch / HEAD: main
Started: 2026-09-04   Completed: In progress
Files changed: tests/password-recovery.int.test.ts,
  tests/password-recovery-routes.test.ts, tests/auth.test.ts,
  mobile/__tests__/sign-in-screen.test.tsx, package.json,
  .github/workflows/ci.yml
Commands and results:
  npx vitest run tests/password-recovery-routes.test.ts   -> 14 passed
  npx vitest run tests/auth.test.ts                      -> 16 passed
  npx vitest run tests/password-recovery.int.test.ts
    (TEST_DATABASE_URL, disposable Postgres 16)           -> 7 passed
  npm --prefix mobile test -- -t "SignInScreen"          -> 7 passed
  npm run typecheck / eslint                              -> clean
Deviations:
  - Native implementation already delivers non-enumerating generic responses,
    digest-only token storage, atomic rollback and single-winner concurrency,
    session_version increment, mobile-session revocation, and supersede-on-reissue.
  - Added route tests covering malformed tokens, expired==consumed non-enumeration,
    rate-limit generic-200, SMTP delivery failure handling (non-enumerating 200),
    cross-origin rejection (403), non-existent/inactive account parity (generic 200),
    and reserved-slot release on weak reset.
  - Added Supabase client tests for requestPasswordReset, completePasswordReset,
    and PASSWORD_RECOVERY auth state event handling.
  - Added mobile unit test for Linking.openURL rejection handling.
  - DB integration tests verify concurrency, atomicity, session_version increment,
    and mobile session revocation.
Open items / Operator-only items:
  - Supabase live PASSWORD_RECOVERY smoke test in live environment.
  - Mailpit or real SMTP native end-to-end flow with browser.
  - Page component and accessibility tests for forgot/reset pages.
  - Playwright E2E recovery test.
```

## CP7 — Pre-merge acceptance matrix (local scope) — Blocked

```
Checkpoint: CP7
Status: Blocked (despite local checks passing; operator/live items outstanding)
Branch / HEAD: mobile-dev @ 7edb0c0 / main @ 1a0ecbd
Commands and results (run 2026-09-04):
  npm run lint                         -> 0 errors (clean)
  npm run typecheck                    -> clean
  npm test                             -> 84 files passed / 735 passed / 8 skipped*
  npm run test:coverage                -> thresholds exceeded (76.31% stmts scoped)
  npm run build (native)               -> clean (EXIT 0)
  npm run build (supabase)             -> clean (EXIT 0)
  npm --prefix mobile lint         -> 0 errors (43 pre-existing warnings)
  npm --prefix mobile run typecheck    -> clean
  npm --prefix mobile test             -> 43 suites passed / 218 passed / 0 failed (EXIT 0)
  git diff --check / git status --short -> clean
  *the 8 skipped = DB integration tests requiring TEST_DATABASE_URL; both .int
   files were separately verified green against a disposable Postgres 16.
Unexpected skips: none in the root suite.
Deviations: none.
Open items (blocking gate):
  - Authenticated Playwright smoke on CI.
  - Docker container image build evidence on CI.
  - Supabase migration clean/historical-lineage convergence on live DB snapshots.
  - Live-function RPC probes and physical mobile device evidence.
```

## CP8 — Merge prepared mobile-dev into main — Local merge performed; not releasable

```
Checkpoint: CP8
Status: Local merge performed under exception; not releasable
Branch / HEAD: main @ 1a0ecbd (merge commit)
Started: 2026-09-04   Completed: Local merge only
Commit: 1a0ecbd chore(merge): merge mobile-dev into main
Commands and results:
  git merge --no-ff mobile-dev                     -> clean merge commit created
  npx vitest run (targeted 8 merge suites)         -> 173 passed (EXIT 0)
  git diff --check                                 -> clean
Unexpected skips: none
Deviations:
  - Local merge was executed to validate integration cleanliness and test suite stability,
    but CP7 remains blocked by outstanding live/CI acceptance evidence.
  - In accordance with checkpoint dependencies, local main is NOT releasable.
  - Push to remote origin and production deployments are strictly blocked until CP7
    and prerequisite approvals (CP0/CP2) are satisfied.
Open items:
  - Satisfy CP0, CP2, CP4, CP5, CP7 prerequisites before any release or remote push.
```

## CP6 / CP15 — Operator prerequisites & live evidence (external)

CP6 requires authorized external environment access (secrets provisioning, proxy
topology, SMTP, Supabase project config, database snapshots) and CP15 requires
installed devices and live environment evidence. MOBILE_BEARER_AUTH_ENABLED
remains false everywhere; no remote push, no deploy, no migration application
was performed.
