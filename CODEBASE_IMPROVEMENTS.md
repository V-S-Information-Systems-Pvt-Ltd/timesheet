# Codebase Improvement Log

Maintained by the `improve` agent. One coherent, verified change per iteration.
Baseline at start: typecheck PASS · lint PASS (1 warning from generated `coverage/` output) · 413 unit tests PASS (1 skipped DB-int) · production build PASS.

## Audit Coverage (sessions 1–5)

Surfaces swept and found clean or by-design: all Server Actions + API route gates; both DB adapters' authz/scoping parity; native + supabase migration chains (constraints, triggers, RPC grants, SECURITY DEFINER hygiene); RLS policies incl. `team_ids`; auth primitives (scrypt/JWT/cookies/timing dummies); rate-limit coverage; import/backup/restore validation; CSV export injection; CSP/security headers; date/cache/smart-hours/telegram/hierarchy pure libraries; pool config; Dockerfile (non-root, standalone). Deliberately not changed (assessed, out of scope per stopping rules): pool-level `statement_timeout` (needs production query-latency evidence); REST leaves/reminders endpoints not charging the daily write budget (authenticated-only, bounded impact).

## Current Backlog

| ID | Priority | Category | Issue | Confidence | Status |
|----|----------|----------|-------|------------|--------|
| *(empty — stopping conditions reached)* | | | | | |

## Completed Improvements

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

