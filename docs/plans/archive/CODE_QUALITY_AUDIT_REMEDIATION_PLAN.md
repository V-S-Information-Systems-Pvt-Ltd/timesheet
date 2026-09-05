# Code Quality Audit Remediation Implementation Plan

## Summary

Close a critical cross-user authorization hole in the Supabase adapter, eliminate
dual-backend authorization drift, give CI a verification net that actually exercises
the SQL and authentication layers, and pay down the two largest structural debts (the
`_actor`-ignoring repository methods and the 2,088-line mobile `SessionProvider`).

The root cause of the security findings is a single function: `server()` in
`lib/db/supabase.ts` returns the **service-role** client whenever
`SUPABASE_SERVICE_ROLE_KEY` is set, which it is in every real deployment. Service role
bypasses RLS, so the 54 repository methods that accept `_actor` and never use it have
no enforcement at any layer. The fix is sequenced: scope the adapter first, flip
`server()` last.

**Native is the authority for parity.** Where the two adapters disagree,
`lib/db/native.ts` defines the intended behavior and `lib/db/supabase.ts` is corrected
to match. Native gates in SQL parameters, is the stricter of the two in every case
found, and is the backend the integration tests can actually exercise.

## Validated Preconditions

Each item is source-verified in the current tree. The working tree is dirty (54+
modified files unrelated to this plan) at the time of the audit.

### Authorization

- `server()` prefers the service-role client and falls back to the anon SSR client only
  when the key is missing (`lib/db/supabase.ts:48-54`). `SUPABASE_SERVICE_ROLE_KEY` is
  documented as required for admin features (`.env.example:15-19`), so the service-role
  branch is the production path. `getAdminClient()` itself is correctly server-only
  (`lib/supabase/admin.ts:1`).
- Call distribution in `lib/db/supabase.ts`: 66 `await server()`, 20 `getAdminClient()`,
  2 `createClient()`. 54 methods take `_actor` and never reference it
  (`lib/db/supabase.ts:118,167,173,186,233,240,246,252,261,271,326,357,370,384,397,409,415,449,457,465,477,487,493,523,529,541,552,559,565,571,577,589,620,628,642,658,679,693,735,805,817,823,829,835,883,1255,1461,1471,1480,1504,1557,1570,1577,1601`).
- Five paths accept a client-supplied identifier with no ownership predicate on
  Supabase, where native enforces one in SQL:

  | Method | native | supabase |
  |---|---|---|
  | `updateReminder` | `where id = $1 and user_id = $3` (`lib/db/native.ts:674-679`) | `.eq('id', id)` only (`lib/db/supabase.ts:487-491`) |
  | `deleteReminder` | `where id = $1 and user_id = $2` (`lib/db/native.ts:681-683`) | `.eq('id', id)` only (`lib/db/supabase.ts:493-497`) |
  | `listReminders` | forces `actor.id`, ignores the parameter (`lib/db/native.ts:657-664`) | `.eq('user_id', userId)` from the caller (`lib/db/supabase.ts:465-475`) |
  | `deleteLeave` | admin bypass, else `and user_id = $2` (`lib/db/native.ts:648-653`) | `.eq('id', id)` only (`lib/db/supabase.ts:457-461`) |
  | `createLeaves` | rejects any row whose `userId !== actor.id` for non-admins (`lib/db/native.ts:626-632`) | inserts rows exactly as supplied (`lib/db/supabase.ts:449-455`) |

- No caller compensates. The services pass the client identifier straight through
  (`lib/api/v1/services/reminders.ts:66,85`, `lib/api/v1/services/leaves.ts:66`), as do
  the web REST handlers (`app/api/data/reminders/route.ts:49,66`,
  `app/api/data/leaves/route.ts:57`) and the v1 mobile routes
  (`app/api/v1/reminders/[id]/route.ts:22,42`, `app/api/v1/leaves/[id]/route.ts:15`).
- The timesheet service demonstrates the correct compensating pattern for contrast:
  fetch, then verify `existing.user_id !== actor.id` before mutating
  (`lib/api/v1/services/timesheets.ts:120-134,184-198,254-263,301-315,414`). The same
  pattern appears in the actions layer (`app/actions/timesheets.ts:69-73,192-196,235-238`).
- `leaveRowsSchema` requires `userId` but never binds it to the actor
  (`lib/validation-schemas.ts:100-109`).
- The RLS policies that would have caught all of this exist and are correct:
  `reminders_select_own`, `reminders_insert_own`, `reminders_update_own`, and
  `reminders_delete_own` all use `auth.uid() = user_id`
  (`supabase/migrations/20260811020000_projects_so_leaves_reminders.sql:78-93`).
  Service role skips them.
- No Supabase-adapter unit tests cover CRUD authorization. `tests/` contains only
  `data-client-supabase`, `supabase-daily-totals`, `supabase-layouts`,
  `supabase-migrations`, and `supabase-restore`. This is why the class of bug survived
  704 passing tests.

### Parity drift

- `listTimesheets`: native ANDs `opts.userId` onto the actor scope unconditionally
  (`lib/db/native.ts:418-421`); Supabase applies it only for see-all actors
  (`lib/db/supabase.ts:295-305`).
- `listLeaves`: native grants the `opts.userId` filter to `isAdminActor` only and gives
  leaders no team visibility (`lib/db/native.ts:595-624`); Supabase uses
  `canSeeAllActor` (admin **and** co) plus a leader team branch
  (`lib/db/supabase.ts:427-442`). Native also has no `LIMIT`; Supabase caps at 1000
  (`lib/db/supabase.ts:442`).
- `listProfiles`: native returns `[]` for a regular user (`lib/db/native.ts:235-253`);
  Supabase returns that user's own row (`lib/db/supabase.ts:102-116`).
- `countTimesheetsByProject`: native gates on `hasPermission(['admin','pm'])` and
  returns 0 otherwise (`lib/db/native.ts:584-591`); Supabase has no gate
  (`lib/db/supabase.ts:415-423`). The method has no caller outside the adapters and the
  interface (`lib/db/repository.ts:281`), so this is latent rather than live.
- `getTimesheetDailyTotals` is correctly admin-gated on both sides
  (`lib/db/native.ts:1406-1407`, `lib/db/supabase.ts:1299-1304`) and is covered by
  `tests/supabase-daily-totals.test.ts`. Use that file as the template for new parity
  tests: it asserts the gate, the client actually used, and the throw-on-error contract.

### Reporting and error handling

- `getGroupedReportTotals` routes any see-all actor with no `userId` filter through
  `getAdminClient()` (`lib/db/supabase.ts:1352-1362`), so the RLS-scoped-RPC guarantee
  stated in `AGENTS.md:57` does not hold on that path. The remaining branch pulls up to
  10,000 rows and aggregates in process, silently truncating
  (`lib/db/supabase.ts:1364-1384`). Native aggregates in SQL under `timesheetScope`
  (`lib/db/native.ts:1416-1447`).
- `writeError` falls back to the raw PostgREST message (`lib/db/supabase.ts:72-79`),
  which reaches the client verbatim through the action layer
  (`app/actions/timesheets.ts:56,216`) and the service layer
  (`lib/api/v1/services/reminders.ts:47,68,87`). Native maps anything unrecognized to a
  generic string (`friendlyWriteError`, `lib/db/native.ts:181-193`).
- `getSubordinateIds` swallows every RPC error and returns `[]`
  (`lib/db/supabase.ts:58-65`), so a leader silently loses team visibility instead of
  failing.
- Roughly 20 `.catch(() => …)` sites in `app/api/v1/**` discard errors. Most are benign
  body-parse defaults, but audit-log writes are fire-and-forget
  (`app/api/v1/admin/users/[id]/route.ts:145,158,172`) and
  `repo.listTitleRecords().catch(() => [])` silently degrades title/hierarchy
  consistency validation (`app/api/v1/admin/users/[id]/route.ts:84`). Three more in
  `app/actions/users.ts:51,213,246`.

### Verification gaps

- Coverage `include` in `vitest.config.mts:25-40` lists five files
  (`lib/validation.ts`, `lib/auth/client.ts`, `lib/backend/config.ts`,
  `lib/data/client.ts`, `app/actions.ts`) with thresholds 60 lines / 60 functions /
  60 statements / 50 branches. Everything else — `lib/db/*`,
  `lib/auth/native.ts|jwt.ts|password.ts`, `lib/rate-limit.ts`, `app/api/**`,
  `app/actions/*.ts`, all of `mobile/` — has no gate. `lib/auth/client.ts` measures
  ~40.5% statements / 44% lines and still passes because thresholds aggregate across
  the five-file scope.
- `TEST_DATABASE_URL` appears nowhere in `.github/workflows/ci.yml` (0 matches), so
  `tests/daily-hours-concurrency.int.test.ts` always skips. No SQL-layer behavior —
  authorization predicates, the legacy-`role` sync trigger, constraints, `team_ids`
  recursion, RLS policies — is verified anywhere in automation.
- The `native-e2e` job seeds an admin via `ADMIN_EMAIL`/`ADMIN_PASSWORD` but never
  exports `E2E_EMAIL`/`E2E_PASSWORD`, so the login/dashboard/logout test skips
  (`e2e/smoke.spec.ts:20`), and `pending-nav.spec.ts:33` skips for want of
  `E2E_PENDING_EMAIL`/`E2E_PENDING_PASSWORD`. Effective CI e2e is "homepage renders"
  plus a login-page axe scan (`e2e/a11y.spec.ts`, 13 lines).
  `playwright.config.ts:7` already loads `.env` through `loadEnvConfig`, so this is
  job-environment wiring, not a config defect.

### Authentication primitives

- `lib/auth/jwt.ts:16-20` validates presence of `AUTH_SECRET` only;
  `lib/auth/mobile-tokens.ts:28-33` enforces at least 32 characters for
  `MOBILE_AUTH_SECRET`. A weak web session secret works silently.
- `verifySessionToken` calls `jwtVerify` with no `algorithms` option
  (`lib/auth/jwt.ts:32`) and sets no issuer or audience. Mobile tokens pin `HS256` plus
  issuer and audience (`lib/auth/mobile-tokens.ts:73-78`).
- Verified sound, no action required: scrypt N=16384/r=8/p=1 with parameter upper
  bounds, `timingSafeEqual`, and a fixed dummy hash for unknown accounts
  (`lib/auth/password.ts`, used at `lib/auth/native.ts:84,116`); session cookie
  `httpOnly`, `sameSite=lax`, `secure` in production (`lib/auth/native.ts:59-63`);
  `originCheck` on state-changing web routes (`app/api/_http.ts:16-41`); every Server
  Action gated by `requireActiveActor` / `requireActor` / `requireSuperAdmin`; every v1
  route behind `requireMobileActor` or `requireMobileSession` with session revocation,
  rotation, and idle/absolute expiry checks (`app/api/v1/_http.ts:40-121`); batch caps
  of 100 items and 366 leave rows (`lib/validation-schemas.ts:100-136`); OS-backed
  mobile token storage with no insecure fallback
  (`mobile/src/platform/secure-storage/native.ts`) and single-flight refresh
  (`mobile/src/auth/session-controller.ts:114-127`); parameterized SQL throughout
  `lib/db/native.ts` (every `${…}` is an identifier list, a `$n` placeholder, or a
  message string) with transactions around multi-statement writes
  (`lib/db/pool.ts:88-108`, `lib/db/native.ts:1169-1355,1666-1702`).

### Structural debt

- `mobile/src/auth/SessionProvider.tsx` is 2,088 lines and re-implements
  try / 401 / `refreshAccessToken` / retry in roughly 60 `useCallback` bodies
  (`:526,560,587,610,634,661,694,731,754,776,797,817,…,1671,1691`), even though
  `mobile/src/api/client.ts:807-815` already performs a single-flight 401 retry and
  `session-controller.ts:114-127` deduplicates the refresh. Functionally safe,
  structurally the largest duplication in the repository. It already splits into four
  context slices (`:238-241,1800-1841,2130-2138`), so the seams exist.
- Other files above 500 lines: `lib/db/native.ts` 1,566; `lib/db/supabase.ts` 1,472;
  `mobile/src/screens/UserAdminScreen.tsx` 1,396; `app/components/ui.tsx` 841;
  `mobile/src/components/TimeEntryForm.tsx` 839; `app/reports/page.tsx` 809;
  `mobile/src/screens/SettingsAdminScreen.tsx` 749; `mobile/src/api/client.ts` 746.
- Baseline hygiene is good: `typecheck` clean in both workspaces, 704 unit tests
  passing, one lint warning (`tests/rate-limit.test.ts:7`, unused `vi`), zero `@ts-*`
  suppressions, zero TODO/FIXME/HACK, no empty catch blocks, `any` confined to 15 sites
  across 7 files (mostly tests).
- `lib/roles.ts:1-10` documents hierarchy roles as `manager | team_lead | user`; the
  type has four values including `engineer` (`app/types.ts:12`).

## Interface and Policy Changes

- Every `Repository` method that receives an `Actor` must use it. `_actor` is permitted
  only where the method is provably actor-independent, and each remaining instance
  carries a comment stating why.
- Both adapters must produce identical authorization outcomes. **`lib/db/native.ts` is
  authoritative** wherever they differ today.
- `server()` becomes user-scoped by default; `getAdminClient()` is reserved for
  operations that genuinely require service role (rate-limit RPCs, Supabase auth admin,
  super-admin data lifecycle). This lands in the final slice, not the first.
- `writeError` returns a generic message for unrecognized errors and logs the raw error
  server-side, matching `friendlyWriteError`.
- `AUTH_SECRET` is validated for a 32-character minimum at first use, and
  `verifySessionToken` pins `HS256`.
- No new runtime dependency. No Server Action renamed or resignatured. No applied
  migration edited.

## Implementation Slices

### 1. Cross-User Write Authorization in the Supabase Adapter

**Blocked by:** None. Ship independently and first.

- Add actor scoping to `updateReminder`, `deleteReminder`, `listReminders`,
  `deleteLeave`, and `createLeaves` in `lib/db/supabase.ts`, mirroring
  `lib/db/native.ts` exactly:
  - `updateReminder` / `deleteReminder` — add `.eq('user_id', actor.id)`; no admin
    bypass, because native has none.
  - `listReminders` — ignore the `userId` parameter and filter on `actor.id`, matching
    the native comment "reminders are own-only regardless of the passed userId". Both
    callers already pass `actor.id` (`lib/api/v1/services/reminders.ts:20`,
    `app/api/data/reminders/route.ts:10`), so no behavior changes for legitimate use.
  - `deleteLeave` — `isAdminActor` bypass, otherwise `.eq('user_id', actor.id)`.
  - `createLeaves` — reject the whole batch with
    `{ error: 'You can only mark leave for yourself.' }` when a non-admin supplies any
    row whose `userId` differs from `actor.id`.
- Add `tests/supabase-repository-authz.test.ts` asserting that a non-owner cannot
  update, delete, or list another user's reminders and leaves, and that `createLeaves`
  refuses a foreign `userId` — parameterized across **both** adapters so the assertions
  are parity assertions rather than adapter-specific ones.
- Verify: `npx vitest run tests/supabase-repository-authz.test.ts`, then `npm test` and
  `npm run typecheck`.

Rationale: on Supabase this is a live cross-tenant data-mutation path reachable by any
authenticated account, invisible to the current suite. It is small, self-contained, and
must not wait behind the sweep.

### 2. CI Verification Net

**Blocked by:** None. Must land before slice 3.

- Export the seeded credentials as `E2E_EMAIL` / `E2E_PASSWORD` in the `native-e2e` job
  so `e2e/smoke.spec.ts` stops skipping.
- Decide whether to seed a deactivated fixture account for `E2E_PENDING_EMAIL` /
  `E2E_PENDING_PASSWORD` or leave `pending-nav.spec.ts` local-only; record the choice
  in the notes file.
- Set `TEST_DATABASE_URL` to the existing Postgres service in `native-e2e` (or a
  dedicated job) so `tests/daily-hours-concurrency.int.test.ts` and future
  `*.int.test.ts` files execute.
- Confirm from the job log that the previously skipped tests now run.

Rationale: slice 3 rewrites authorization predicates across the 49 `_actor` methods slice 1 did not already cover. Doing that
without an executing SQL-layer and login-path suite is the highest-risk ordering
available.

### 3. `_actor` Scoping Sweep and Parity Convergence (native authoritative)

**Blocked by:** Slices 1 and 2.

Work in per-domain batches, each with its own parity test and its own verification run:
timesheets → profiles → projects and activity types → leaves → settings and layouts →
titles and whitelisted domains → remaining super-admin lifecycle.

- Give each remaining `_actor` method in `lib/db/supabase.ts` (49 after slice 1) an explicit predicate mirroring
  `lib/db/native.ts`, or a comment justifying actor-independence.
- Resolve the four known divergences **in favor of native**:

  | Method | Native rule to adopt | Effect on Supabase mode | Verified UI impact |
  |---|---|---|---|
  | `listTimesheets` | AND `opts.userId` onto the scope for every actor (`lib/db/native.ts:418-421`) | a leader filtering to an out-of-team user gets `[]` instead of their own rows | none: the filter is only surfaced to see-all actors |
  | `listLeaves` | `opts.userId` honored for `isAdminActor` only; every non-admin is pinned to `actor.id`; add native's missing `LIMIT` at 1000 to both (`lib/db/native.ts:595-624`) | `co` loses the cross-user leave filter; leaders lose team leave visibility | callers pass `opts` straight through (`app/api/data/leaves/route.ts:23`, `lib/api/v1/services/leaves.ts:30`); no component assumes team leave |
  | `listProfiles` | return `[]` for a regular user (`lib/db/native.ts:235-253`) | a regular user no longer receives their own row from this method | none: `/api/v1/people` already gates on `canViewTeamActor` (`lib/api/v1/services/people.ts:11-18`); `app/dashboard/page.tsx:192` only fetches when `canSeeAll`; `app/reports/page.tsx:189` fetches unconditionally but the consuming dropdowns render only under `isReportRole` (`app/reports/page.tsx:83,654`) |
  | `countTimesheetsByProject` | gate on `hasPermission(['admin','pm'])`, else 0 (`lib/db/native.ts:584-591`) | none today — no caller outside the adapters | none |

- Extend `tests/supabase-repository-authz.test.ts`, or add per-domain siblings, so each
  divergence has a regression test that fails against the old behavior.

Rationale for native as the authority: it is the stricter adapter in all four cases, it
enforces in SQL parameters rather than relying on an RLS layer that service role
bypasses, and it is the backend slice 2 can actually integration-test. Adopting the
looser Supabase behavior would mean widening data access to close a parity gap.

### 4. Error Hygiene and Secret Validation

**Blocked by:** None; sequence after slice 3 to keep diffs reviewable.

- `writeError` returns a generic message for unrecognized codes and logs the raw error
  through `logger` (`lib/db/supabase.ts:72-79`).
- `getSubordinateIds` logs and propagates instead of returning `[]`
  (`lib/db/supabase.ts:58-65`); the return type distinguishes "no team" from
  "lookup failed".
- `AUTH_SECRET` gains a 32-character minimum in `lib/auth/jwt.ts` `secret()`; pin
  `algorithms: ['HS256']` in `verifySessionToken`.
- Route the audit-log and `listTitleRecords` swallow sites through `logger.warn`
  (`app/api/v1/admin/users/[id]/route.ts:84,145,158,172`,
  `app/actions/users.ts:51,213,246`).
- Rework `getGroupedReportTotals`: use the user-scoped client for the RPC, or assert
  `SECURITY INVOKER` plus server-side actor scoping; page or count-guard the
  10,000-row fallback so it cannot silently truncate
  (`lib/db/supabase.ts:1341-1384`).
- Add a failure-mode test per change.

### 5. `server()` Flip

**Blocked by:** Slices 1, 2, 3, and 4.

- Change `server()` to return `createClient()` and call `getAdminClient()` only at the
  sites that require service role. Enumerate and justify each remaining service-role
  call in the notes file.
- Run the full suite plus the now-executing integration and e2e jobs in both backend
  modes. Any RLS policy gap surfaces here as a functional failure, which is the point
  of doing it last.

### 6. Coverage Gate Expansion

**Blocked by:** Slice 3, so the gate measures the new tests.

- Expand `vitest.config.mts` coverage `include` to `lib/**` and `app/api/**`, keeping
  `lib/supabase/database.types.ts` excluded.
- Add per-file thresholds so a single weak module cannot hide inside an aggregate;
  `lib/auth/client.ts` at ~40% is the current example.
- Raise thresholds incrementally to what the expanded scope actually sustains rather
  than asserting a number the suite cannot meet.

### 7. Mobile SessionProvider Decomposition

**Blocked by:** None; independent of the backend work.

- Delete the ~60 per-action 401 retry blocks in `mobile/src/auth/SessionProvider.tsx`
  and rely on the centralized single-flight retry in `mobile/src/api/client.ts:807-815`.
- Extract domain groups (admin users, projects, activity types, titles, leaves,
  reminders, layout and branding) into separate hooks or modules behind the existing
  four context slices, preserving `SessionContextValue` so screens do not change.
- Keep `mobile/__tests__/session-provider.test.tsx` and
  `mobile/__tests__/session-controller.test.ts` green throughout; add a test proving a
  single 401 causes exactly one refresh across concurrent callers.

### 8. Residual Hygiene

**Blocked by:** None.

- Remove the unused `vi` import (`tests/rate-limit.test.ts:7`).
- Correct the stale hierarchy-role comment (`lib/roles.ts:1-10`) against
  `app/types.ts:12`.
- Extend axe coverage beyond the login page to the dashboard and at least one dialog
  (`e2e/a11y.spec.ts`).

## Verification

- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run test:coverage` after
  every slice.
- `npm --prefix mobile run lint`, `npm --prefix mobile run typecheck`, and
  `npm --prefix mobile test` for slice 7.
- `npm run build` in **both** `NEXT_PUBLIC_BACKEND=supabase` and `native`, matching the
  CI matrix.
- Targeted runs during development, for example
  `npx vitest run tests/supabase-repository-authz.test.ts`.
- After slice 2, confirm from CI logs that `daily-hours-concurrency.int.test.ts` and the
  `smoke.spec.ts` dashboard test execute rather than skip.
- After slice 5, confirm the Supabase security advisor reports no new findings and that
  every remaining `getAdminClient()` call is listed with a justification.

## Rollout and Recovery

- Slice 1 is independently deployable and should not wait for the rest.
- Slices 1, 3, and 5 change authorization outcomes. Each is revertible on its own; do
  not squash them together.
- Slice 3 narrows data visibility in Supabase mode for `co` and leader roles
  (`listLeaves`) and for regular users (`listProfiles`). Announce these as intentional
  before deploying, because affected users will perceive them as missing data.
- Slice 5 has the widest blast radius. Deploy to a nonproduction Supabase project first
  and exercise a full authenticated journey per permission role (`admin`, `pm`, `co`,
  `user`) and per hierarchy role (`manager`, `team_lead`, `engineer`, `user`).
- No migration is added or edited by this plan. If a slice concludes an RLS policy is
  missing, add a new `supabase/migrations` file — never edit an applied one.
- If slice 5 reveals missing RLS coverage that cannot be closed safely, stop and keep
  `server()` on the service-role client. The adapter-level scoping from slices 1 and 3
  is then the enforcement layer, and that must be recorded explicitly rather than left
  implicit as it is today.

## Out of Scope

- Splitting `lib/db/native.ts` or `lib/db/supabase.ts` into per-domain modules. Real
  debt, but a 1,500-line move would obscure the authorization diffs that matter here.
- Web UI refactors: `app/reports/page.tsx`, `app/dashboard/*`, `app/components/ui.tsx`.
- `mobile/src/screens/UserAdminScreen.tsx` decomposition.
- Reducing the ~286 non-null assertions.
- Changing access-token formats, session lifetimes, rate-limit budgets, or
  authentication routes.
- Dependency upgrades or a new dependency audit.
- Anything already tracked in `SECURITY_REVIEW_REMEDIATION_PLAN.md` (TLS/HSTS, health
  and cron endpoints, `TRUSTED_PROXY_HOPS`, native credential modules).

## Assumptions and Stop Conditions

- The working tree is dirty at audit time. Establish a clean baseline, or explicitly
  accept the uncommitted changes as the baseline, before slice 1.
- `lib/db/native.ts` defines the intended authorization semantics for slice 3. The four
  resolutions in that slice narrow Supabase-mode access; they are corrections, not
  feature removals.
- A nonproduction Supabase project is available for slice 5.
- Stop the affected slice if:
  - One of the four parity divergences turns out to be intentional product behavior
    that native has wrong — resolve the intended rule with the release owner before
    changing either adapter.
  - Slice 2 cannot run integration tests because the CI Postgres service is unsuitable;
    slice 3 then proceeds only with explicit acknowledgement that the sweep is
    unverified at the SQL layer.
  - Slice 5 surfaces RLS gaps that would require editing applied migrations.
  - Expanded coverage thresholds cannot be met without writing tests that assert mock
    interactions rather than behavior.
- Record deviations, verification output, and final evidence in
  `docs/plans/CODE_QUALITY_AUDIT_REMEDIATION_NOTES.md`.
