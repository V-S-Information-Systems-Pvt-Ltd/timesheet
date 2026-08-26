# Codebase Improvement Log

Maintained by the `improve` agent. One coherent, verified change per iteration.
Baseline at start: typecheck PASS · lint PASS (1 warning from generated `coverage/` output) · 413 unit tests PASS (1 skipped DB-int) · production build PASS.

## Audit Coverage (sessions 1–5)

Surfaces swept and found clean or by-design: all Server Actions + API route gates; both DB adapters' authz/scoping parity; native + supabase migration chains (constraints, triggers, RPC grants, SECURITY DEFINER hygiene); RLS policies incl. `team_ids`; auth primitives (scrypt/JWT/cookies/timing dummies); rate-limit coverage; import/backup/restore validation; CSV export injection; CSP/security headers; date/cache/smart-hours/telegram/hierarchy pure libraries; pool config; Dockerfile (non-root, standalone). Deliberately not changed (assessed, out of scope per stopping rules): pool-level `statement_timeout` (needs production query-latency evidence); REST leaves/reminders endpoints not charging the daily write budget (authenticated-only, bounded impact).

Navigation-flow session (iterations 12–14): swept login/dashboard/reports/change-password routing, AppShell nav gating, and the native API gate matrix — `requireActive` everywhere except `/api/data/profile` (`requireSignedIn`, feeds the pending view) and the session-level auth routes. Verified pending-account parity across backends: own-profile read and password change both work while inactive in supabase (RLS/auth-level) and native (`requireSignedIn`) modes.

## Current Backlog

| ID | Priority | Category | Issue | Confidence | Status |
|----|----------|----------|-------|------------|--------|
| NAV-001 | P1 | Correctness | Pending accounts could open `/reports` directly and see an empty report view instead of the approval flow. | High | FIXED |
| NAV-002 | P2 | Correctness | Signed-in user whose profile fetch fails on `/reports` was stranded on a permanent blank page (no UI, no navigation). | High | FIXED |
| NAV-003 | P3 | UX/Correctness | Dashboard rendered "Account Pending Approval" even when the profile fetch merely failed (error text shown alongside), conflating unknown state with pending state. | Medium | FIXED |
| NAV-004 | P3 | Testing | New inactive-user redirects lacked runtime e2e coverage. | High | FIXED |
| E2E-001 | P2 | Testing/DX | Playwright never loaded `.env.local` (credentials invisible to specs) and the smoke spec used ambiguous `text=Sign in` locators that broke under strict mode. | High | FIXED |
| NAV-005 | P3 | UX | A pending screen does not auto-refresh when an admin activates the account mid-session; the user must reload (no profile-change push/polling in either backend). | High | FIXED |
| AUTHZ-001 | P2 | Security/Parity | Native `bulkUpdateTimesheets` let COs edit anyone's rows (`canSeeAllActor`), while the action layer, supabase adapter, and native `updateTimesheet`/`deleteTimesheet` all restrict cross-user edits to admins. | High | FIXED |
| VAL-002 | P2 | Validation/Parity | Supabase-mode leaves/reminders are written by the browser straight through PostgREST; RLS checks ownership only, so `reason`/`message` had no length bound (native REST routes cap both at 500). | High | FIXED |
| VAL-003 | P3 | Validation | `global_reminders.message` (admin-only Server Action) and `profiles.department`/`title` (`updateMyProfile`) have no length cap in either backend mode — consistent, but unbounded. | Medium | OPEN |
| VAL-004 | P2 | Validation/Parity | Import and restore paths wrote `timesheets.work_done` verbatim in both adapters, bypassing the `sanitizeWorkDone` tag-strip/2000-char cap every other write path enforces. | High | FIXED |

## Completed Improvements

### Iteration 20 — VAL-004

**Problem**
The CSV-import and backup-restore paths wrote `timesheets.work_done` verbatim in both adapters, bypassing `sanitizeWorkDone` (HTML tag strip + whitespace collapse + 2000-char cap) that `createTimesheet`, `updateTimesheet`, and `bulkUpdateTimesheets` all enforce inside the repository. A crafted import row or backup file could persist unbounded, unsanitized text.

**Evidence**
`lib/db/native.ts` importTimesheets pushed raw `row.workDone`; restoreBackup inserted `t.work_done || 'restored entry'`. Same two sites in `lib/db/supabase.ts` (`work_done: r.workDone` / `work_done: t.work_done || 'restored entry'`). The import action only trims. Severity tempered: React escapes rendered text (no XSS) and CSV exports escape formula prefixes — the defect is a policy/parity bypass with unbounded length.

**Root Cause**
Sanitization was applied per-write-site when the bulk paths were added; import/restore predate or skipped it.

**Files Changed**
- lib/db/native.ts
- lib/db/supabase.ts
- tests/native-repository.test.ts
- tests/supabase-restore.test.ts

**Implementation**
Applied `sanitizeWorkDone` at all four repo sites (`importTimesheets` + `restoreBackup` in each adapter), matching the established repo-level pattern; restore keeps the `'restored entry'` fallback for rows that sanitize to empty. Regression tests capture the actual insert payloads/params in both adapters and assert dirty HTML normalizes to the clean form.

**Verification**
- targeted tests: PASS (37 across both suites incl. 4 new)
- lint: PASS · typecheck: PASS
- full unit suite: PASS (466 passed, 1 skipped)
- production build: PASS

**Regression Risk**
Low — imported/restored entries now normalize exactly like form-entered ones. Obscure edge: a description of pure tags sanitizes to empty and fails the native NOT NULL on the import path (previously stored literal tags); restore falls back gracefully.

**Remaining Risk**
None known.

### Iteration 19 — VAL-002

**Problem**
In supabase mode the browser writes leaves and personal reminders directly through PostgREST (`lib/data/client.ts`); RLS checks only ownership. The length bounds the native REST routes enforce (`leaveRowsSchema`/`reminderSchema`: reason ≤ 500, message ≤ 500) existed nowhere on the supabase path, so any authenticated user with the public anon key could persist unbounded-length text into their own rows.

**Evidence**
`supabaseDataClient.insertLeaves`/`insertReminder` call PostgREST directly; `leaves_insert_own`/`reminders_insert_own` policies gate only `auth.uid() = user_id`; neither schema defined CHECK constraints (supabase 20260811020000, native 0001); native routes validate via `lib/validation-schemas.ts`.

**Root Cause**
Bounds were added at the native REST boundary only; the database — the authoritative boundary for supabase mode — never received matching constraints.

**Files Changed**
- supabase/migrations/20260904000000_bound_leave_reminder_text.sql (new)
- db/migrations/0017_bound_leave_reminder_text.sql (new)
- lib/backup.ts
- tests/supabase-migrations.test.ts
- tests/db-migrations.test.ts
- tests/backup.test.ts

**Implementation**
`NOT VALID` CHECK constraints (`char_length(reason) <= 500`, `char_length(message) <= 500`) in both migration chains: enforced on all new writes without scanning existing rows (which may exceed the bound via the previously unvalidated path). `parseBackup` now truncates leave reasons and reminder messages to the same bounds so restoring a legacy backup cannot fail the whole run against the new constraints. Static regression tests in both migration test suites lock the constraints in.

**Verification**
- targeted tests: PASS (migration guards + backup parser incl. 3 new)
- lint: PASS · typecheck: PASS
- full unit suite: PASS (461 passed, 1 skipped)
- production build: PASS

**Regression Risk**
Low — app-written values are already within bounds in practice; NOT VALID leaves existing data untouched. Restore of legacy backups now truncates instead of failing.

**Remaining Risk**
Live-DB constraint behavior NOT VERIFIED locally (requires a migrated database). The per-request 366-row cap remains native-only by design: cumulative row count is unbounded in both modes (no rate limit on leaves), so a statement-level trigger would add little real security.

### Iteration 18 — AUTHZ-001

**Problem**
Native `bulkUpdateTimesheets` scoped cross-user edits with `canSeeAllActor` (admin OR co), so a CO could edit anyone's rows at the repository boundary. The action layer (`bulkUpdateTimesheets` gates with `isAdminActor`), the supabase adapter (`canEditAll = isAdminActor`), and the native adapter's own `updateTimesheet`/`deleteTimesheet` all restrict cross-user edits to admins — COs may see all but edit only their own.

**Evidence**
`lib/db/native.ts` bulkUpdateTimesheets used `canSeeAllActor(actor)` for the UPDATE scope and the rowError message; `lib/db/supabase.ts` uses `isAdminActor(actor)`; `app/actions/timesheets.ts` gates with `isAdminActor(actor)`. The `co` actor is defined in `tests/native-repository.test.ts` but had no bulk-update coverage.

**Root Cause**
The native bulk path was written with the read-scope helper (`canSeeAllActor`) instead of the write-scope rule (`isAdminActor`), diverging from every other write path.

**Files Changed**
- lib/db/native.ts
- tests/native-repository.test.ts

**Implementation**
Changed the bulk-update scope and rowError branch to `isAdminActor(actor)`, matching the action layer, the supabase adapter, and the native single-row update/delete paths. Added a regression test asserting a CO's bulk UPDATE carries the CO's id as the ownership scope param (fails before the fix, passes after).

**Verification**
- targeted tests: PASS (`tests/native-repository.test.ts`, 28 incl. 1 new)
- lint: PASS · typecheck: PASS
- full unit suite: PASS (458 passed, 1 skipped)
- production build: PASS

**Regression Risk**
Low — the action layer already blocks COs from reaching cross-user bulk edits, so no legitimate behavior changes; the repo boundary now enforces the same rule as every other write path.

**Remaining Risk**
None known.

### Iteration 17 — NAV-005

**Problem**
A user left on the "Account Pending Approval" screen had to manually reload to be admitted after an admin activated their account; there was no auto-refresh in either backend.

**Evidence**
The pending view (`app/dashboard/page.tsx`) rendered a static approval screen with only a Logout action; `fetchProfile` already re-runs the full data load when `is_active` flips true, so the transition machinery existed but was never triggered.

**Root Cause**
No mechanism re-checked the profile while the account was pending.

**Files Changed**
- app/dashboard/page.tsx

**Implementation**
While `classifyAccountView` returns `'pending'` (and a user is signed in), a `useEffect` polls `fetchProfile(user.id)` every 15s; the interval is torn down as soon as the account is no longer pending or the user signs out. When an admin activates the account, the next poll flips the view to `'ready'` and the existing data-load path admits the user automatically. A transient poll failure surfaces the existing profile-error view with its Try again recovery.

**Verification**
- typecheck: PASS · lint: PASS
- full unit suite: PASS (457 passed, 1 skipped)
- production build: PASS

**Regression Risk**
Low — active users are unaffected (interval never starts); pending users see the same screen, now with automatic admission. No React component-testing infra exists in the repo, so the effect is verified by typecheck/build rather than a unit test.

**Remaining Risk**
Runtime browser transition NOT VERIFIED (requires a deactivated fixture account + an admin to activate it mid-session).

### Iteration 16 — NAV-004

**Problem**
The pending-account navigation flow (NAV-001/002/003) had no executed runtime coverage; the spec existed but was BLOCKED on fixture credentials.

**Evidence**
Fixture credentials (`E2E_PENDING_EMAIL`/`E2E_PENDING_PASSWORD`) were provided in `.env.local`. First execution caught a real transient: Supabase rejected the freshly minted token with "JWT issued at future" (clock skew), and the dashboard correctly rendered NAV-003's error view — nav gating still held — instead of a false "pending approval".

**Root Cause**
Spec asserted the approval screen rigidly and could not tolerate the transient profile-fetch failure window.

**Files Changed**
- e2e/pending-nav.spec.ts
- e2e/smoke.spec.ts

**Implementation**
`waitForPendingScreen` helper drives the error view's own Try again recovery until the approval screen appears (bounded `expect(...).toPass`), then asserts zero `/reports` nav links and that a `/reports` deep link bounces to `/dashboard`. The authenticated smoke test now skips cleanly when only pending credentials are configured, matching the repo's fixture-gating convention.

**Verification**
- typecheck: PASS · lint: PASS
- e2e: 3 passed / 1 skipped, two consecutive green runs
- Runtime-verified: pending login → approval screen → no Reports nav → `/reports` bounce → `/dashboard`; includes recovery through the transient error view

**Regression Risk**
Low — specs only.

**Remaining Risk**
Smoke auth journey currently skips locally (no active-user creds configured); it passes when `E2E_EMAIL`/`E2E_PASSWORD` are present (verified in iteration 15).

### Iteration 15 — E2E-001

**Problem**
First real e2e run failed: (1) Playwright's Node process never reads `.env.local`, so `E2E_EMAIL`/`E2E_PASSWORD` were invisible to specs ("Missing env var"); (2) the smoke spec's `text=Sign in` locator matched both the "Sign In" tab and the submit button — a strict-mode violation from when signup tabs were added to the login page.

**Evidence**
`npm run e2e` output: 2 failed / 1 passed; error contexts showed the strict-mode resolution to two buttons and the missing-env throw at `e2e/smoke.spec.ts:9`.

**Root Cause**
Env loading and page structure drifted from the spec assumptions; e2e had not been runnable locally before credentials existed.

**Files Changed**
- playwright.config.ts
- e2e/smoke.spec.ts
- e2e/pending-nav.spec.ts (new)
- .gitignore (ignore `/test-results`, `/playwright-report` artifacts)

**Implementation**
Load `.env`/`.env.local` in the Playwright config via `@next/env` (`loadEnvConfig`, already in the dependency tree — no new package). Scoped both sign-in assertions to `form >> getByRole('button', { name: 'Sign In' })`. Added `e2e/pending-nav.spec.ts` covering NAV-001/002 runtime behavior (approval screen, no Reports nav, `/reports` deep-link bounce); it auto-skips without `E2E_PENDING_EMAIL`/`E2E_PENDING_PASSWORD`, mirroring the `TEST_DATABASE_URL` convention.

**Verification**
- typecheck: PASS (after matching @next/env's `Log` object signature)
- lint: PASS
- e2e: 3 passed, 1 skipped (pending spec — needs fixture account)
- Runtime-verified with updated credentials: login → dashboard → logout journey against Supabase mode

**Regression Risk**
Low — test infrastructure only; no app code touched.

**Remaining Risk**
Pending-flow assertions are written but NOT YET EXECUTED (NAV-004 stays BLOCKED until a deactivated fixture account exists).

### Iteration 14 — NAV-003

**Problem**
The dashboard rendered "Account Pending Approval" whenever `profile` was null — including when `getProfile` failed (network error, 500, missing row). The approval claim was shown alongside the raw error text, telling users their account is awaiting activation when the real state was unknown.

**Evidence**
`app/dashboard/page.tsx` fetchProfile routed profile errors into the generic `dataError`, and the render gate was `(!profile || !profile.is_active)` regardless of cause. Verified `/api/data/profile` uses `requireSignedIn` (not `requireActive`), so pending users in both backends load their own profile fine — the null-profile path is genuinely exceptional and must not masquerade as "pending".

**Root Cause**
Account-state classification conflated "profile unknown" with "profile loaded but inactive".

**Files Changed**
- app/dashboard/page.tsx
- lib/navigation.ts
- tests/navigation-flow.test.ts

**Implementation**
New pure classifier `classifyAccountView(profile, profileError)` → `'error' | 'pending' | 'ready'`. Profile-load failures now set a dedicated `profileError` (cleared on success/sign-out/logout) and render a "Something went wrong" view with Try again + Logout; the pending-approval screen renders only for a loaded inactive profile (its now-unreachable inline `dataError` line removed). Missing profile row without an error also classifies as `error`.

**Verification**
- targeted tests: PASS (`tests/navigation-flow.test.ts`, 6 incl. 4 new)
- lint: PASS
- typecheck: PASS
- full test suite: PASS (457 passed, 1 skipped)
- production build: PASS

**Regression Risk**
Low — active users and genuinely-pending users see identical screens; only the previously-misleading failure path changed.

**Remaining Risk**
Runtime browser behavior NOT VERIFIED (see NAV-004).

### Iteration 13 — NAV-002

**Problem**
On `/reports`, a signed-in user whose `getProfile` returned null (transient fetch failure or RLS denial) hit the `!profileData` branch, which only stopped the spinner — the page then rendered `if (!profile) return null`: a permanent blank screen with no navigation and no message.

**Evidence**
`app/reports/page.tsx:118-122` (post-NAV-001) plus the `if (!profile) return null` render guard; `lib/data/client.ts:105-109` shows `getProfile` resolves `{ data: null }` on error instead of throwing, so the branch is reachable.

**Root Cause**
Terminal "profile unavailable" state had no UI and no routing — unlike the signed-out (`replace('/')`) and inactive (`replace('/dashboard')`) branches.

**Files Changed**
- app/reports/page.tsx

**Implementation**
Merged the null-profile case into the dashboard redirect: `if (!profileData || !profileData.is_active) router.replace('/dashboard')`. The dashboard owns account-state display (pending approval / load error); no redirect loop is possible because the dashboard never routes back to `/reports`.

**Verification**
- lint: PASS
- typecheck: PASS
- full test suite: PASS (453 passed, 1 skipped)
- production build: PASS
- Runtime browser behavior NOT VERIFIED (see NAV-004)

**Regression Risk**
Low — active users with a readable profile are unaffected; only the previously-blank path changes.

**Remaining Risk**
None known beyond the missing runtime e2e coverage.

### Iteration 12 — NAV-001

**Problem**
Pending accounts were gated only inside the dashboard. The shared shell exposed Reports, and `/reports` checked authentication but not `profile.is_active`.

**Evidence**
Dashboard rendered the pending approval state, while Reports continued after loading an inactive profile. Native data routes reject inactive accounts, leaving Reports with misleading empty data.

**Root Cause**
Account activation was not applied consistently at the page and navigation boundaries.

**Files Changed**
- app/components/ui.tsx
- app/dashboard/page.tsx
- app/reports/page.tsx
- app/change-password/page.tsx
- lib/navigation.ts
- tests/navigation-flow.test.ts

**Implementation**
Reports now redirects inactive accounts to `/dashboard`. Pending accounts see only Dashboard in the shared navigation, including the mobile drawer, and do not see Change Password. Active state is passed explicitly by authenticated pages.

**Verification**
- targeted test: PASS (`tests/navigation-flow.test.ts`)
- lint: PASS
- typecheck: PASS
- full test suite: PASS (453 passed, 1 skipped)
- production build: PASS

**Regression Risk**
Low.

**Remaining Risk**
The inactive-user redirect still requires an authenticated browser/e2e environment for runtime verification.

### Iteration 11 — BACKUP-001

**Problem**
Backup restore accepted syntactically shaped but impossible calendar dates (for example `2026-02-30`) and deferred the failure to the database.

**Evidence**
`lib/backup.ts` previously used only a `YYYY-MM-DD` regular expression, while `lib/validation.ts` already provides `isValidISODate` that rejects rolled-over dates. Restore writes can then fail after earlier Supabase writes or roll back the native transaction.

**Root Cause**
The backup parser duplicated weaker date validation instead of using the strict shared validator.

**Files Changed**
- lib/backup.ts
- tests/backup.test.ts

**Implementation**
Reuse `isValidISODate` for timesheet and leave backup dates; add regression coverage for impossible dates.

**Verification**
- targeted tests: PASS (`tests/backup.test.ts`)
- typecheck: PASS
- lint: PASS
- full suite: PASS
- production build: PASS (supabase + native)

**Regression Risk**
Low — valid exported dates are unchanged; malformed dates now fail before any restore writes.

**Remaining Risk**
Supabase restore still performs multiple writes without a database transaction if a later valid row encounters an operational failure; fixing that requires a transactional RPC/architecture decision.

### Iteration 10 — SIGNUP-001

**Problem**
`POST /api/auth/signup` (unauthenticated) stored the optional `name` field verbatim with no length cap — a client could persist arbitrarily large strings into `profiles.name` (bounded only by body-size limits and the 10/hour IP limiter).

**Evidence**
Pre-fix route did `name.trim()` immediately before INSERT; no schema/length check. Sibling name fields are capped at 200 (`projectSchema`, `activityTypeSchema`).

**Root Cause**
Signup route validated email/password but not the third user-supplied field.

**Files Changed**
- app/api/auth/signup/route.ts
- tests/signup-route.test.ts

**Implementation**
Reject `name` > 200 chars (after trim) with a 400 alongside the other field validations, before the rate limiter and any DB lookup.

**Verification**
- typecheck: PASS · lint: PASS · full suite: PASS (448)
- production build: PASS (supabase + native modes)

**Regression Risk**
None for names ≤ 200 chars (existing tests pass unchanged).

**Remaining Risk**
None known.

### Iteration 9 — HIER-001

**Problem**
Native `public.team_ids` used `UNION ALL` in its recursive CTE, which does not terminate if a reporting cycle ever exists in `profiles.manager_id` — every leader-scoped query (`t.user_id = any(public.team_ids($1))`) would recurse until the pool exhausts memory. The supabase variant already used `UNION` for exactly this reason.

**Evidence**
`db/migrations/0006_user_hierarchy.sql:31` (`union all`) vs `supabase/migrations/20260819000000_user_hierarchy.sql:22-24` (comment documents UNION-for-cycle-termination). App-layer guards exist (`setUserManager`, `wouldCreateHierarchyCycle`) but are read-then-write and racy across concurrent admins; out-of-band DB edits bypass them entirely.

**Root Cause**
Native definition predated the cycle-safety fix applied to the supabase variant.

**Files Changed**
- db/migrations/0016_cycle_safe_team_ids.sql (new)
- tests/db-migrations.test.ts (new)

**Implementation**
New migration recreating `team_ids` with `UNION` (applied-migration files untouched). Static regression test asserts the latest definition contains no `UNION ALL`.

**Verification**
- typecheck: PASS · lint: PASS · full suite: PASS (447)
- production build: PASS (supabase + native modes)
- Live-DB behavior NOT VERIFIED locally (requires migrated Postgres / TEST_DATABASE_URL)

**Regression Risk**
Low — `UNION` only dedupes visited ids during traversal; acyclic trees return identical results.

**Remaining Risk**
None known.

### Iteration 8 — RLS-001

**Problem**
Supabase `public.team_ids(uuid)` is SECURITY DEFINER and granted to `authenticated`, but accepted an arbitrary target: any signed-in user could RPC it via PostgREST with another profile's UUID and enumerate that person's direct + indirect reports, harvesting org structure and profile UUIDs the `profiles_select_*` policies never exposed.

**Evidence**
`supabase/migrations/20260819000000_user_hierarchy.sql:40` grants execute to authenticated; body traversed from `manager_id = target` with no caller check. All legitimate callers (the two `_select_team` policies) pass `auth.uid()`. The supabase adapter never calls it directly (grep: only `get_timesheet_daily_totals` / `get_grouped_report_totals` RPCs).

**Root Cause**
Function semantics narrowed to "caller's own subtree" by policy design, but the body never enforced it.

**Files Changed**
- supabase/migrations/20260903000000_guard_team_ids_target.sql (new)
- tests/supabase-migrations.test.ts

**Implementation**
Guard migration: body returns `array[]::uuid[]` unless `target = auth.uid()`; policy behavior unchanged. Regression test locks the guard on the latest definition. Native's `db/migrations/0006` definition intentionally unguarded (no `auth.uid()` context there).

**Verification**
- typecheck: PASS · lint: PASS · targeted: PASS (5 tests incl. 2 new)
- production build: PASS (both modes)
- Live RLS behavior NOT VERIFIED locally (requires a Supabase instance)

**Regression Risk**
Low — every in-repo call site passes `auth.uid()`; verified no adapter/client usage of the RPC.

**Remaining Risk**
None known.

### Iteration 7 — REM-001

**Problem**
`POST/PATCH /api/data/reminders` coerced fields with `String()`: empty messages, garbage timestamps, and blank ids reached the DB layer and surfaced as 500s; `reminderSchema` existed but was never used.

**Evidence**
`app/api/data/reminders/route.ts` (pre-fix) used `String(body?.message ?? '')`; the global-reminder Server Action (`app/actions/settings.ts:59-73`) validates message + parses remindAt — parity gap.

**Root Cause**
REST routes written without the validation layer applied elsewhere.

**Files Changed**
- app/api/data/reminders/route.ts
- lib/validation-schemas.ts
- tests/reminders-route.test.ts (new)

**Implementation**
Wire `reminderSchema` into POST (message 1–500 trimmed, remindAt must parse; normalized to ISO before persisting, matching the Server Action). PATCH requires a non-blank string id.

**Verification**
- typecheck: PASS · lint: PASS · full suite: PASS (443)
- production build: PASS (supabase + native modes)

**Regression Risk**
Low — previously-500 paths now 400; valid payloads unchanged.

**Remaining Risk**
None known.

### Iteration 6 — LEAVES-001

**Problem**
`POST /api/data/leaves` forwarded raw unvalidated rows to the repo: missing/mistyped `userId`, non-ISO dates, and unbounded row counts produced DB-level 500s and enabled oversized inserts.

**Evidence**
Pre-fix route passed `body.rows` straight to `repo.createLeaves` after only an `Array.isArray` check.

**Root Cause**
No boundary schema for the leaves REST endpoint.

**Files Changed**
- app/api/data/leaves/route.ts
- lib/validation-schemas.ts
- tests/leaves-route.test.ts (new)

**Implementation**
New `leaveRowsSchema` (userId required, ISO leaveDate, reason ≤500 defaulting '', 1–366 rows) applied via `parseSchema` → clean 400s with field errors.

**Verification**
- typecheck: PASS · lint: PASS · targeted: PASS (7 new tests)
- production build: PASS (both modes)

**Regression Risk**
Low — the UI's payload shape (`{ userId, leaveDate, reason }`) validates unchanged.

**Remaining Risk**
None known.

### Iteration 5 — VAL-001

**Problem**
`GET /api/data/timesheets?dateFrom=…&dateTo=…` accepted arbitrary strings; malformed values caused backend date-cast errors → 500 instead of 400. The reports route already validated its equivalents.

**Evidence**
`timesheetQuerySchema` typed dateFrom/dateTo as plain optional strings; reports route uses `isValidISODate` + 400.

**Root Cause**
Query schema omitted the ISO-date refinement.

**Files Changed**
- lib/validation-schemas.ts
- tests/timesheets-api.test.ts

**Implementation**
Added `.refine(isValidISODate)` on dateFrom/dateTo with explicit messages.

**Verification**
- typecheck: PASS · lint: PASS · targeted: PASS (3 new tests)
- production build: PASS (both modes)

**Regression Risk**
None for valid YYYY-MM-DD inputs.

**Remaining Risk**
None known.

### Iteration 4 — CSV-001

**Problem**
`escapeCsvCell` did not neutralize spreadsheet formula prefixes (`=`,`+`,`-`,`@`,tab,CR). User-controlled `work_done`, project/type names, and emails flow into CSV exports (`lib/reports.ts`, `app/reports/page.tsx`, admin user panel); a cell like `=WEBSERVICE(...)` would execute when an admin opens the export in Excel/LibreOffice (CWE-1236).

**Evidence**
`sanitizeWorkDone` strips HTML tags but preserves formula characters; exports are built from stored rows without further escaping.

**Root Cause**
Escaper implemented quoting/CSV-syntax rules only, not spreadsheet formula-injection rules.

**Files Changed**
- lib/csv.ts
- tests/csv.test.ts

**Implementation**
Per OWASP guidance: cells whose first character is one of `= + - @ \t \r` get a leading apostrophe before standard CSV quoting.

**Verification**
- typecheck: PASS · lint: PASS · full suite: PASS (424)
- production build: PASS (supabase mode; native-mode build re-run in iteration 7)

**Regression Risk**
Low — no legit exported cell starts with those characters (dates/digits/emails/names); negative numbers would be prefixed but hours are validated > 0.

**Remaining Risk**
Defense targets Excel/LibreOffice defaults; other spreadsheet apps may interpret additional prefixes.

### Iteration 3 — DX-001

**Problem**
`eslint .` scanned generated `coverage/` artifacts, emitting a permanent "Unused eslint-disable directive" warning that drowned real signal.

**Evidence**
Baseline `npm run lint`: 1 warning at `coverage/lcov-report/block-navigation.js`; `eslint.config.mjs` overrides eslint-config-next's default ignores without re-adding `coverage/**`.

**Root Cause**
The globalIgnores override dropped the coverage directory from the ignore list.

**Files Changed**
- eslint.config.mjs

**Implementation**
Added `coverage/**` to `globalIgnores`.

**Verification**
- lint: PASS (0 errors, 0 warnings)
- typecheck: PASS
- full unit suite: PASS (418)

**Regression Risk**
None — ignores only.

**Remaining Risk**
None.

### Iteration 2 — SEC-001

**Problem**
`POST /api/auth/change-password` allowed unlimited current-password guesses for any authenticated session; login was already limited to 10 failures/hour but password change was not.

**Evidence**
`app/api/auth/login/route.ts:23-38` rate-limits failed sign-ins; `app/api/auth/change-password/route.ts` had no limiter before invoking `changePassword`.

**Root Cause**
Limiter added to login but not to the sibling current-password verification path.

**Files Changed**
- app/api/auth/change-password/route.ts
- lib/rate-limit.ts
- tests/auth-routes.test.ts

**Implementation**
New `RATE_LIMIT_PASSWORD = 10/hour` budget keyed `pwchange:<userId>:<ip>`; peek-reject with 429 + Retry-After, consume only on failed verification (mirrors login semantics). Cheap 400-validation paths never touch the limiter.

**Verification**
- typecheck: PASS
- lint: PASS
- targeted tests: PASS (`tests/auth-routes.test.ts` 20 incl. 3 new regressions; rate-limit + timing suites unaffected)
- full unit suite: PASS (418)

**Regression Risk**
Low — additive guard; success path unchanged (no budget consumed on success).

**Remaining Risk**
In-memory limiter is per-instance (documented existing limitation of lib/rate-limit.ts).

### Iteration 1 — TS-001

**Problem**
Native `listTimesheets` ignored `opts.userId`; the supabase adapter applies it. `/api/data/timesheets?userId=…` returned unfiltered results in native mode (admin user panel per-user counts wrong).

**Evidence**
`lib/db/supabase.ts:221` applies `eq('user_id', opts.userId)`; `lib/db/native.ts:340` built its WHERE from `timesheetScope(actor)` + date filters only. Consumer: `app/dashboard/user-whitelist.tsx:79`.

**Root Cause**
Filter dropped when the function was reworked around `timesheetScope`.

**Files Changed**
- lib/db/native.ts
- tests/native-repository.test.ts

**Implementation**
Append `t.user_id = $N` to the scoped WHERE (intersected with actor scope; param indices shifted for date filters), mirroring supabase+RLS semantics.

**Verification**
- typecheck: PASS
- lint: PASS
- targeted tests: PASS (`tests/native-repository.test.ts`, 27 incl. 2 new regressions)
- full unit suite: PASS (415)

**Regression Risk**
Low — SQL shape unchanged when `opts.userId` is absent (all pre-existing assertions pass).

**Remaining Risk**
None known. Native DB-integration coverage requires TEST_DATABASE_URL (skipped locally).
