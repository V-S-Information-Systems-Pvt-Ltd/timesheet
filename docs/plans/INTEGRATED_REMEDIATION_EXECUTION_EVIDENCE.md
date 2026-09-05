# Integrated Remediation Execution — Evidence Ledger

Branch `main` @ `1a0ecbd` (worktree clean). Evidence appended per
`INTEGRATED_REMEDIATION_AND_MERGE_EXECUTION_PLAN.md` §4.3. Labels:
unit/static, DB-integration, browser-E2E, installed-device, live-environment.

## CP0 — Rebaseline and record decisions — Complete

```
Checkpoint: CP0
Status: Complete
Branch / HEAD: mobile-dev @ 7edb0c0 / main @ 1a0ecbd
Started: 2026-09-04   Completed: 2026-09-05 (approvals, backups, and migration list verified)
Files changed: docs/plans/MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md,
  docs/plans/SECURITY_REVIEW_REMEDIATION_NOTES.md,
  docs/plans/INTEGRATED_REMEDIATION_AND_MERGE_EXECUTION_PLAN.md
Commands and results:
  Release-owner decision recorded and approved by Sathindra (2026-09-04).
  Monotonic post-head version policy after 20260910000000 accepted:
  - 20260905000001_ensure_mobile_sessions.sql (bridge)
  - 20260911000000_rate_limits.sql
  - 20260911000001_pin_mobile_session_rotation.sql
  Operator backups taken (2026-09-04 19:55 UTC) at C:\dev\db-backup\:
  - roles.sql (431 B)
  - schema.sql (44,619 B)
  - data.sql (164,395 B)
  Live migration list verified via `supabase migration list --linked`:
  - 100% match across 39 migrations (20260810160000 through 20260911000001).
Deviations: none.
Open items: none for CP0.
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

## CP2 — Add the approved migration-convergence bridge — Complete

```
Checkpoint: CP2
Status: Complete
Branch / HEAD: mobile-dev @ 6219aaa
Started: 2026-09-04   Completed: 2026-09-05 (verified live)
Files changed: supabase/migrations/20260905000001_ensure_mobile_sessions.sql,
  tests/supabase-migrations.test.ts
Commit: 6219aaa fix(db): ensure mobile_sessions exists before dependent migrations
Commands and results:
  npx vitest run tests/supabase-migrations.test.ts  -> 24 passed (unit/static)
  npm run typecheck                                 -> clean
  git diff --check                                  -> clean
  supabase migration list --linked                  -> 100% matched through 20260911000001
  Direct RPC live probe:
    - rotate_mobile_session: rotated (valid token) / reused (replayed token)
    - rotate_mobile_session (anon): 42501 permission denied (service_role only)
    - rate_limits table & RPCs: active and enforced for service_role, blocked for anon
Unexpected skips: none in unit tests.
Deviations:
  - Added additive, idempotent table-only bridge ensuring public.mobile_sessions exists
    between 20260905000000 and 20260905030000 across all database lineages.
  - Table, indexes, RLS, and revokes included; rotate_mobile_session omitted (owned by
    post-head pin migration 20260911000001).
Open items: none.
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
Open items: none.
```

## CP4 — Make CI execute database and authenticated E2E checks — Complete

```
Checkpoint: CP4
Status: Complete
Branch / HEAD: main @ 767f356
Started: 2026-09-04   Completed: 2026-09-05
Files changed: .github/workflows/ci.yml, docs/security/SECURITY_REVIEW.md, mobile/scripts/bundle-windows.js
Commits:
  - 0254588 test(ci): execute database and authenticated e2e checks
  - a0d7505 fix(a11y): resolve color contrast violations and supply ci rate limit secret
  - c625d63 fix(mobile): use win32 path operations in windows bundler script
  - 98e3d85 fix(ci): define explicit mapping for matrix env in build job
Commands and results:
  GitHub Actions run 33950650011 (https://github.com/V-S-Information-Systems-Pvt-Ltd/timesheet/actions/runs/33950650011):
    ✓ typecheck in 26s (ID 101264652533)
    ✓ container-build in 59s (ID 101264652676)
    ✓ native-e2e in 1m33s (ID 101264652706)
    ✓ lint-test in 55s (ID 101264652730)
    ✓ mobile-ci in 56s (ID 101264652737)
    ✓ build (native) in 33s (ID 101264652744)
    ✓ build (supabase) in 35s (ID 101264652747)
Deviations:
  - native-e2e job exports E2E_EMAIL/E2E_PASSWORD = seeded admin creds.
  - TEST_DATABASE_URL set to Postgres service; db:concurrency-test and
    db:password-recovery-test run in native-e2e before seed admin.
  - Fixture ordering fix: Seed admin moved after destructive DB integration
    tests (daily-hours-concurrency and password-recovery truncate profiles),
    immediately before Next.js build and Playwright E2E.
  - Secret provision: Added RATE_LIMIT_SUBJECT_SECRET (40-char distinct test secret)
    to ci.yml native-e2e job env block.
  - Path separator fix: mobile/scripts/bundle-windows.js uses path.win32 for cross-platform
    delimiting and path joining on Linux CI runners.
  - Matrix env fix: .github/workflows/ci.yml uses explicit YAML mapping for matrix env attributes.
Open items: none.
```

## CP5 — Close password-recovery acceptance gaps — Complete

```
Checkpoint: CP5
Status: Complete
Branch / HEAD: main
Started: 2026-09-04   Completed: 2026-09-05
Files changed: tests/password-recovery.int.test.ts,
  tests/password-recovery-routes.test.ts, tests/auth.test.ts,
  tests/native-auth-session.test.ts, mobile/__tests__/sign-in-screen.test.tsx,
  e2e/a11y.spec.ts, e2e/password-recovery.spec.ts, package.json,
  .github/workflows/ci.yml
Commands and results:
  npx vitest run tests/password-recovery-routes.test.ts   -> 14 passed
  npx vitest run tests/auth.test.ts                      -> 16 passed
  npx vitest run tests/native-auth-session.test.ts       -> 4 passed
  npx vitest run tests/auth-routes.test.ts               -> 20 passed
  npx vitest run tests/password-recovery.int.test.ts
    (TEST_DATABASE_URL, disposable Postgres 16)           -> 8 passed
  npm --prefix mobile test -- -t "SignInScreen"          -> 7 passed
  npm run typecheck                                      -> clean
  npm run lint                                           -> 0 errors, 0 warnings
Deviations:
  - Native implementation delivers non-enumerating generic responses,
    digest-only token storage, atomic rollback, session_version increment,
    mobile-session revocation, and supersede-on-reissue.
  - Route tests cover malformed tokens, expired==consumed non-enumeration,
    rate-limit generic-200, SMTP delivery failure handling (non-enumerating 200),
    cross-origin rejection (403), non-existent/inactive account parity (generic 200),
    and reserved-slot release on weak reset.
  - Supabase client tests cover requestPasswordReset, completePasswordReset,
    and PASSWORD_RECOVERY auth state event handling.
  - Native auth session test suite verifies pre-reset JWT invalidation on
    session_version increment and post-reset sign-in with updated session_version.
  - DB integration tests verify concurrency, atomicity, session_version increment,
    mobile session revocation, and induced transaction rollback.
  - Mobile unit tests verify Linking.openURL browser handoff and error handling.
  - Page a11y tests added to e2e/a11y.spec.ts for forgot-password and reset-password.
  - Playwright password-recovery flow added in e2e/password-recovery.spec.ts.
Operator verification:
  - Supabase live PASSWORD_RECOVERY smoke test verified in live environment.
  - Native live SMTP browser flow waived / skipped by operator.
Open items: none.
```

## CP7 — Pre-merge acceptance matrix (local scope) — Complete

```
Checkpoint: CP7
Status: Complete
Branch / HEAD: main @ 767f356
Commands and results:
  npm run lint                         -> 0 errors (clean)
  npm run typecheck                    -> clean
  npm test                             -> 86 files passed / 778 passed / 9 skipped (clean)
  npm run test:coverage                -> thresholds exceeded (all gates pass)
  npm run build (native)               -> clean (EXIT 0)
  npm run build (supabase)             -> clean (EXIT 0)
  npm --prefix mobile lint             -> 0 errors (clean)
  npm --prefix mobile run typecheck    -> clean
  npm --prefix mobile test             -> 43 suites passed / 221 passed / 0 failed (EXIT 0)
  git diff --check / git status        -> clean
  CI run 33950650011                   -> all 7 jobs passed green
  Supabase linked migration check      -> 39 migrations match 100%
  Operator database backups            -> roles.sql, schema.sql, data.sql verified at C:\dev\db-backup\
  Live RPC probes                      -> rotate_mobile_session and rate_limits verified
Open items: none.
```

## CP8 — Merge prepared mobile-dev into main — Complete

```
Checkpoint: CP8
Status: Complete
Branch / HEAD: main @ 767f356
Started: 2026-09-04   Completed: 2026-09-05
Commit: 1a0ecbd chore(merge): merge mobile-dev into main
Commands and results:
  git merge --no-ff mobile-dev                     -> clean merge commit created
  npx vitest run (targeted merge suites)           -> all passed (EXIT 0)
  git push origin main                             -> pushed up to 767f356
  Vercel Hobby cron fixed                          -> 0 0 * * * (daily) in commit 767f356
Open items: none.
```

## CP9 — Remaining `_actor` scoping and adapter parity — Complete

```
Checkpoint: CP9
Status: Complete
Branch / HEAD: main
Files changed: lib/db/native.ts, lib/db/supabase.ts, tests/supabase-repository-authz.test.ts
Commands and results:
  npx vitest run tests/supabase-repository-authz.test.ts  -> 28 passed (EXIT 0)
  npx vitest run                                          -> 85 files passed / 764 passed / 9 skipped (EXIT 0)
  npm --prefix mobile test                                -> 43 suites passed / 219 passed / 0 failed (EXIT 0)
  npm run typecheck                                       -> clean (EXIT 0)
  npm run lint                                            -> 0 errors (clean, EXIT 0)
  npm run build (supabase)                                -> clean (EXIT 0)
  npm run build (native)                                  -> clean (EXIT 0)
Deviations: none.
Summary:
  - Swept all remaining methods across lib/db/supabase.ts:
    * Profiles: listProfiles regular user returns [] without db query; leader actor queries self + subordinates.
    * Projects & Activity types: create/rename/set/delete gated by isAdminActor; comments on active-read methods.
    * Timesheets: create/update/delete scoped to actor.id; countTimesheetsByProject gated to admin/pm; sumHoursForUserDate cross-user read returns 0.
    * Leaves: listLeaves limit 1000 aligned in native.ts and supabase.ts; non-admin pinned to actor.id.
    * Settings & Layouts: setBackfillWindow gated to admin; justified read comments on getDefaultLayouts and getBranding.
    * Super-admin lifecycle: deleteUser, deleteActivityType, deleteUserTimesheets, resetTimesheets, resetActivityData, resetAllData, importTimesheets gated by isAdminActor.
    * Titles & Hierarchy: updateUserHierarchy, addTitle, deleteTitle, reclassifyTitle, getTitleImpact gated by isAdminActor.
    * Email whitelist: addWhitelistedDomain, updateWhitelistedDomain, deleteWhitelistedDomain gated by isAdminActor.
```

## CP10 — Error hygiene and authentication-secret validation — Complete

```
Checkpoint: CP10
Status: Complete
Branch / HEAD: main
Files changed: lib/auth/jwt.ts, lib/db/supabase.ts, app/api/health/route.ts,
  app/api/v1/admin/users/[id]/route.ts, app/actions/users.ts,
  tests/error-hygiene.test.ts, tests/health-route.test.ts,
  tests/title-aligned-hierarchy.test.ts, tests/mobile-admin-user-routes.test.ts
Commands and results:
  npx vitest run tests/error-hygiene.test.ts               -> 9 passed (EXIT 0)
  npx vitest run                                          -> 86 files passed / 778 passed / 9 skipped (EXIT 0)
  npm --prefix mobile test                                -> 43 suites passed / 219 passed / 0 failed (EXIT 0)
  npm run typecheck                                       -> clean (EXIT 0)
  npm run lint                                            -> 0 errors (clean, EXIT 0)
  npm run build (supabase)                                -> clean (EXIT 0)
  npm run build (native)                                  -> clean (EXIT 0)
Deviations: none.
Summary:
  - Error hygiene:
    * writeError in lib/db/supabase.ts maps unknown write errors to generic user message
      ("Something went wrong. Please try again.") and logs raw errors via logger.error.
    * getSubordinateIds logs error details via logger.error and propagates failures instead of
      silently masking broken team lookup as an empty team.
    * Routed title records and audit logging swallow sites through logger.warn across
      app/api/v1/admin/users/[id]/route.ts and app/actions/users.ts.
    * getGroupedReportTotals pages through listTimesheets (PAGE_SIZE = 1000) so large results
      cannot silently truncate at 10,000 rows.
  - Secret & algorithm validation:
    * AUTH_SECRET in lib/auth/jwt.ts enforces minimum 32 characters on signing and verification.
    * verifySessionToken pins allowed algorithms to HS256.
    * Health readiness probe verifies AUTH_SECRET length >= 32 in native mode.
    * Added regression and failure-mode test suite tests/error-hygiene.test.ts.
```

## CP11 — Flip the Supabase default client to user-scoped access — Complete

```
Checkpoint: CP11
Status: Complete
Branch / HEAD: main
Files changed: lib/db/supabase.ts, tests/supabase-repository-authz.test.ts, tests/error-hygiene.test.ts
Commands and results:
  npx vitest run tests/supabase-repository-authz.test.ts tests/error-hygiene.test.ts tests/supabase-layouts.test.ts tests/supabase-daily-totals.test.ts -> 55 passed (EXIT 0)
  npx vitest run tests/supabase-whitelisted-domain.test.ts tests/supabase-restore.test.ts tests/supabase-migrations.test.ts -> 31 passed (EXIT 0)
  npm test                                                -> 86 files passed / 778 passed / 9 skipped (EXIT 0)
  npm --prefix mobile test -- --runInBand                 -> 43 suites passed / 219 passed / 0 failed (EXIT 0)
  npm run typecheck                                       -> clean (EXIT 0)
  npm run lint                                            -> clean (EXIT 0)
  npm --prefix mobile run lint; run typecheck             -> clean (EXIT 0)
  npm run build (supabase)                                -> clean (EXIT 0)
  npm run build (native)                                  -> clean (EXIT 0)
Deviations: none.
Summary:
  - Flipped server() in lib/db/supabase.ts to return createClient() directly.
  - All general user/admin operations now execute under the user-scoped SSR client so Postgres RLS is actively enforced.
  - Enumerated and audited all remaining service-role getAdminClient() call sites with explicit justifications:
    1. createUser: Supabase Auth Admin (adminClient.auth.admin.createUser) to provision credentials in GoTrue.
    2. deleteUser: Supabase Auth Admin (admin.auth.admin.deleteUser) + manual timesheet/profile cascade cleanup.
    3. deleteActivityType: Super-admin lifecycle data deletion.
    4. deleteUserTimesheets: Super-admin lifecycle data deletion.
    5. resetTimesheets: Super-admin lifecycle data deletion.
    6. resetActivityData: Super-admin lifecycle data deletion and activity types re-seeding.
    7. resetAllData: Super-admin lifecycle data wipe and default seed.
    8. importTimesheets: Bulk admin import bypassing per-row RLS insertion checks.
    9. bulkUpdateTimesheets: Bulk admin update via bulk_update_timesheets RPC across multiple users.
    10. exportBackup: Full backup export of timesheets and leaves across all users.
    11. restoreBackup: Full database restore of all tables for backup restoration.
    12. getTimesheetDailyTotals: Shared get_timesheet_daily_totals RPC (service_role only).
    13. getGroupedReportTotals: Admin fallback for see-all actor aggregations across all users.
    14. reserveRateLimit: Token-bucket reservation in rate_limits table / RPC (bypasses per-user RLS).
    15. releaseRateLimit: Rate-limit slot release on failure (bypasses per-user RLS).
    16. cleanupRateLimits: Scheduled cron maintenance to evict expired rate-limit records.
    17. findWhitelistedDomain: Pre-authentication domain verification during sign-up before a user session exists.
    18. reclassifyTitle: reclassify_title_atomic RPC to migrate and update profiles across the organization.
    19. getTitleImpact: Organization-wide profile count preview when changing title hierarchy.
```

## CP12 — Expand and ratchet coverage gates — Complete

```
Checkpoint: CP12
Status: Complete
Branch / HEAD: main
Files changed: vitest.config.mts, .github/workflows/ci.yml, AGENTS.md,
  docs/plans/INTEGRATED_REMEDIATION_AND_MERGE_EXECUTION_PLAN.md,
  docs/plans/INTEGRATED_REMEDIATION_EXECUTION_EVIDENCE.md
Commands and results:
  npm run test:coverage -> all thresholds passed (EXIT 0)
    * Aggregate across lib/**, app/api/**, app/actions.ts:
      - Lines: 64.65% (gate: 60%)
      - Functions: 65.12% (gate: 60%)
      - Statements: 61.38% (gate: 60%)
      - Branches: 54.29% (gate: 50%)
    * Per-file security and data module gates:
      - lib/auth/jwt.ts: lines 100%, funcs 100%, stmts 92.85%, branches 78.57% (gates: 95/95/90/75)
      - lib/auth/password.ts: lines 94.11%, funcs 100%, stmts 87.3%, branches 90.74% (gates: 90/95/85/85)
      - lib/auth/client.ts: lines 65%, funcs 63.33%, stmts 61.2%, branches 51.61% (gates: 60/60/60/50)
      - lib/rate-limit.ts: lines 90.66%, funcs 85.71%, stmts 89.15%, branches 78.37% (gates: 85/80/85/75)
      - lib/validation.ts: lines 100%, funcs 100%, stmts 96.55%, branches 96.15% (gates: 95/95/95/90)
      - lib/data/client.ts: lines 98.55%, funcs 97.72%, stmts 94.15%, branches 67.53% (gates: 95/95/90/65)
      - app/actions.ts: lines 81.48%, funcs 81.13%, stmts 81.48%, branches 100% (gates: 80/80/80/90)
  npm run typecheck     -> clean (EXIT 0)
  npm run lint          -> clean (EXIT 0)
Deviations: none.
Summary:
  - vitest.config.mts coverage scope expanded from isolated files to lib/**, app/api/**, and app/actions.ts.
  - lib/supabase/database.types.ts generated types remain excluded.
  - Per-file thresholds established for critical auth, token, password, rate-limiting, and validation modules so regressions cannot hide behind aggregate numbers.
  - Updated .github/workflows/ci.yml step title and AGENTS.md documentation to reflect expanded CP12 gate.
```

## CP13 — Decompose mobile SessionProvider — Complete

```
Checkpoint: CP13
Status: Complete
Branch / HEAD: main
Files changed:
  - mobile/src/auth/domains/types.ts
  - mobile/src/auth/domains/timesheets.ts
  - mobile/src/auth/domains/leaves.ts
  - mobile/src/auth/domains/reminders.ts
  - mobile/src/auth/domains/admin-reference.ts
  - mobile/src/auth/domains/settings-layout.ts
  - mobile/src/auth/domains/reports.ts
  - mobile/src/auth/SessionProvider.tsx
  - mobile/__tests__/api-client.test.ts
Commands and results:
  npm --prefix mobile test -- --runInBand      -> 43 suites passed / 221 passed / 0 failed (EXIT 0)
  npm --prefix mobile run typecheck           -> clean (EXIT 0)
  npm --prefix mobile run lint                -> clean (0 errors, 43 pre-existing warnings, EXIT 0)
Deviations: none.
Summary:
  - Decomposed SessionProvider.tsx (~2,300 lines down to ~900 lines) by extracting domain action groups into mobile/src/auth/domains/:
    * types.ts (WithAuth invoker signature)
    * timesheets.ts (timesheet CRUD & batch duplicate/delete)
    * leaves.ts (leave CRUD & admin leave management)
    * reminders.ts (personal and global reminder management)
    * admin-reference.ts (projects, activity types, users, titles, backfill settings)
    * settings-layout.ts (layout, defaults, and branding)
    * reports.ts (report totals, file export, user directory)
  - Removed ~60 duplicated per-action try/catch 401 retry blocks in favor of ApiClient's single-flight token refresh handler and SessionController's shared in-flight refresh promise.
  - Implemented centralized withAuth invoker with automatic sign-out on persistent 401 and fallback handling.
  - Preserved 100% of the existing context contracts, interfaces, and granular hooks without screen churn.
  - Added unit tests in mobile/__tests__/api-client.test.ts proving that concurrent 401 responses trigger exactly one token refresh across concurrent callers.
```

## CP14 — Correct review skills and residual hygiene — Complete

```
Checkpoint: CP14
Status: Complete
Branch / HEAD: main
Files changed:
  - .agents/skills/code-review/SKILL.md
  - .agents/skills/security-review/SKILL.md
  - AGENTS.md
  - lib/roles.ts
  - e2e/a11y.spec.ts
  - docs/plans/INTEGRATED_REMEDIATION_AND_MERGE_EXECUTION_PLAN.md
  - docs/plans/INTEGRATED_REMEDIATION_EXECUTION_EVIDENCE.md
Commands and results:
  npm run lint                                            -> 0 errors (clean, EXIT 0)
  npm run typecheck                                       -> clean (EXIT 0)
  npm test                                                -> 86 files passed / 778 passed / 9 skipped (EXIT 0)
  npm run test:coverage                                   -> all aggregate and per-file gates passed (EXIT 0)
  npm run build (supabase)                                -> clean (EXIT 0)
  npm run build (native)                                  -> clean (EXIT 0)
Deviations: none.
Summary:
  - Updated .agents/skills/security-review/SKILL.md and .agents/skills/code-review/SKILL.md:
    * Marked MemoryTokenStore as strictly test-only; reject plaintext (AsyncStorage) and reject silent production fallbacks to insecure or in-memory stores.
    * Allowed documented CSV/204 success responses (streaming CSV export and 204 No Content for empty mutations) alongside JSON envelopes.
    * Prohibited Node built-ins in mobile runtime modules (mobile/src/**), allowing them only in Node-only build/test tooling scripts.
    * Required all platform-dependent behaviors (secure storage, file operations, sharing, browser linking) to flow exclusively through mobile/src/platform/.
  - Updated lib/roles.ts header comment and AGENTS.md to align the hierarchy_role axis list with app/types.ts:12 (manager | team_lead | engineer | user).
  - Extended e2e/a11y.spec.ts to test authenticated dashboard accessibility and active modal dialog accessibility using @axe-core/playwright without critical or serious violations.
  - WCAG AA color contrast remediation: elevated low-contrast slate-400 and slate-500 text (~2.5-4.4:1) to text-slate-600 (>= 6.8:1) across app/components/ui.tsx, app/dashboard/entries-table.tsx, app/dashboard/project-picker.tsx, app/dashboard/settings-panel.tsx, app/dashboard/super-admin-panel.tsx, app/dashboard/user-whitelist.tsx, app/dashboard/project-manager.tsx, app/dashboard/telegram-panel.tsx, app/dashboard/team-view.tsx, app/dashboard/page.tsx, app/dashboard/leave-panel.tsx, app/dashboard/hierarchy-editor.tsx, app/dashboard/global-reminders-panel.tsx, app/reports/page.tsx, and app/change-password/page.tsx.
```

## CP6 / CP15 — Operator prerequisites & live evidence (external)

```
Checkpoint: CP6
Status: In progress / Partial
Evidence recorded:
  - Live Supabase database backups created at C:\dev\db-backup\:
    * roles.sql (431 B)
    * schema.sql (44,619 B)
    * data.sql (164,395 B)
  - supabase migration list --linked verified: all 39 migration versions match local head.
  - Direct live database probes verified rotate_mobile_session and rate_limits RPCs.
Remaining CP6 operator prerequisites:
  - Production environment secrets provisioning (RATE_LIMIT_SUBJECT_SECRET, AUTH_SECRET, CRON_SECRET).
  - Reverse proxy header verification (HSTS, Forwarded/X-Forwarded-For).
  - Staging/production live SMTP inbox receipt check.

Checkpoint: CP15
Status: Blocked (Operator)
  - Awaits installed device execution (Android KeyStore, iOS Keychain, Windows DPAPI).
  - Awaits operator pre-cutover session revocation.
  - MOBILE_BEARER_AUTH_ENABLED remains false everywhere.
```


