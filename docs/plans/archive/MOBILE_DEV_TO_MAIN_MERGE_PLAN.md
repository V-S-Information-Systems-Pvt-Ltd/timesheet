# `mobile-dev` → `main` merge plan

**Date:** 2026-09-04
**Source:** `mobile-dev` @ `1b4f226`
**Target:** `main` @ `2a77608`
**Status:** proposed — no merge, rename, push, or deploy performed

## Summary

`mobile-dev` is internally healthy: clean tree, both backend builds green, 708
root tests + 218 mobile tests passing, coverage above the CI gate. It is *not*
mergeable as-is. Three independent problems block it, and only one of them is a
conflict-resolution exercise:

1. **8 files / 12 conflict hunks**, and in six of them `main` is the correct
   side because `main` carries three security fixes made after the branch point
   (backfill-window enforcement on delete/update/bulk paths, a `canEditAll`
   tightening, and a `manager_id` freeze policy). A careless "keep ours"
   resolution silently reverts all three.
2. **A Supabase migration version collision.** `mobile-dev` and `main` both
   used `20260904000000` and `20260905000000` for different SQL. Because the
   Supabase CLI reconciles by *version*, not content, a database fed from
   `main` will skip `20260904000000_mobile_sessions.sql` and then **fail hard**
   on the next migration that touches that table.
3. **A new hard-required environment variable.** `RATE_LIMIT_SUBJECT_SECRET`
   throws outside the caller's `try`, so an unset value turns every login,
   signup, and password flow into a 500 — a deploy-time outage, not a
   degradation.

A fourth item is pre-existing rather than introduced: the Supabase adapter
performs unscoped cross-user writes on leaves and reminders. That code is
byte-identical on `origin/main`. The merge does not create the hole, but it
does add the `app/api/v1/**` bearer surface that makes it reachable from a
mobile client, so the merge changes its exploitability, not its existence.

## Recommendation

**Merge, but as a four-commit sequence on `mobile-dev` first, gated on one
release-owner decision and one new migration. Use a merge commit, not a
squash.**

Concretely, in this order:

1. **M1** — merge `origin/main` into `mobile-dev` and resolve the 12 hunks
   with `main` authoritative on every security-bearing hunk (§Slice M1).
2. **M2** — add `supabase/migrations/20260905000001_ensure_mobile_sessions.sql`,
   an idempotent table-only migration. This is the whole migration fix: it
   converges all three database lineages with **no** `supabase migration
   repair` and **no** renaming of already-pushed versions (§Migration
   convergence).
3. **M3** — close the reachable half of the authorization hole: scope
   `createLeaves` / `deleteLeave` / `listReminders` / `createReminder` /
   `updateReminder` / `deleteReminder` in `lib/db/supabase.ts` to match
   `lib/db/native.ts`, which is already correct. This is slice 1 of
   `CODE_QUALITY_AUDIT_REMEDIATION_PLAN.md`, pulled forward.
4. **M4** — provision and validate `RATE_LIMIT_SUBJECT_SECRET`, `CRON_SECRET`,
   and `TRUSTED_PROXY_HOPS` in every target environment.
5. **M5** — wire the database integration test and authenticated Playwright
   smoke path into CI so the final green run is meaningful.
6. **M6** — merge the prepared branch into `main` with `--no-ff` after every
   acceptance gate passes.

**Do not** renumber `mobile-dev`'s two colliding migrations post-head. That
direction looks tidier but it is the unsafe one: it would make a
`mobile-dev`-fed database skip `bound_leave_reminder_text` and
`freeze_manager_id_own_update` entirely, dropping the `manager_id` freeze — a
security regression traded for filename hygiene. §Migration convergence shows
why the additive migration dominates both renaming directions.


**On M3's placement:** it is defensible to merge without it, because the hole
already exists on `main`. It is not defensible to merge without *deciding*. If
the release owner defers M3, the merge must ship with `MOBILE_BEARER_AUTH_ENABLED=false`
in every environment so the new reachability is not activated, and M3 becomes a
release blocker for enabling that flag.

## Validated preconditions

Verified read-only on `mobile-dev` @ `1b4f226` before this plan was written.

| Check | Result |
| --- | --- |
| Audit baseline | clean at `mobile-dev` @ `1b4f226`, per the supplied review |
| Current workspace | no tracked modifications; pre-existing untracked `.claude/` and this plan are preserved |
| Root `npm run lint` | clean |
| Root `npm run typecheck` | clean |
| Root `npm test` | 708 passed, 1 skipped |
| Root `npm run test:coverage` | 76.31 / 62.90 / 81.88 / 79.01 vs the 60/60/60/50 gate |
| `npm run build` (`NEXT_PUBLIC_BACKEND=supabase`) | exit 0 |
| `npm run build` (`NEXT_PUBLIC_BACKEND=native`) | exit 0 |
| `mobile` lint | 0 errors, 43 warnings |
| `mobile` `tsc --noEmit` | clean |
| `mobile` `npm test` | 218 passed |
| Lockfiles | in sync in both workspaces |
| Native migrations | `0017`–`0024` are additions only; no applied migration edited |
| Tracked secrets | none; `deploy/secret.yaml` holds placeholders only |

Two gaps in that evidence, both stated rather than resolved:

- **`docker build` was not run.** The Docker Desktop Linux engine was not
  running in this environment. Mitigating fact: `Dockerfile` and
  `.dockerignore` are unchanged versus `main` (only `docker-compose.yml`
  differs, +3 lines), so CI's `container-build` job carries low risk.
- **The e2e and DB-integration suites never actually execute in CI.**
  `E2E_EMAIL`, `E2E_PASSWORD`, and `TEST_DATABASE_URL` appear zero times in
  `.github/workflows/ci.yml`, so `e2e/smoke.spec.ts:21` and every
  `*.int.test.ts` skip themselves. A green CI run does not mean the
  authenticated web flows or the native SQL authz predicates were exercised.
  This is slice 2 of `CODE_QUALITY_AUDIT_REMEDIATION_PLAN.md` and is the single
  highest-leverage follow-up after the merge.

## Migration convergence

`main`'s Supabase head is `20260905000000_freeze_manager_id_own_update.sql`.
`mobile-dev`'s head is `20260911000001_pin_mobile_session_rotation.sql`. The two
branches reused two version prefixes for unrelated SQL:

| Version | on `origin/main` | on `mobile-dev` |
| --- | --- | --- |
| `20260904000000` | `bound_leave_reminder_text.sql` | `mobile_sessions.sql` |
| `20260905000000` | `freeze_manager_id_own_update.sql` | `fix_mobile_session_rotation.sql` |

`mobile-dev` already re-filed `main`'s two as `20260905010000_bound_leave_reminder_text.sql`
and `20260905020000_freeze_manager_id_own_update.sql` (pure renames, content
identical). Both are re-run safe: the first uses
`alter table … drop constraint if exists` then re-adds, the second uses
`drop policy if exists` / `create or replace function` / `create policy`.

### Why the collision is fatal in a `main`-fed database

The Supabase CLI records applied migrations by version string. A database fed
from `main` already has `20260904000000` and `20260905000000` in
`supabase_migrations.schema_migrations`, so after the merge it **skips**
`20260904000000_mobile_sessions.sql` — `public.mobile_sessions` is never
created. Two later migrations then reference that table:

- `20260905030000_index_cleanup_and_tuning.sql:11-12` —
  `create index if not exists mobile_sessions_cleanup_idx on public.mobile_sessions (…)`.
  The `if not exists` guards the *index* name, not the table, so this raises
  `relation "public.mobile_sessions" does not exist`.
- `20260911000001_pin_mobile_session_rotation.sql:43` — the `create or replace
  function` body declares `public.mobile_sessions%rowtype`. With the default
  `check_function_bodies = on`, the plpgsql validator resolves that at creation
  time and fails the same way.

So `supabase db push` aborts mid-history at `20260905030000`. That is a loud
failure rather than a silent one, which is the only good news here: the deploy
stops instead of running on a half-migrated schema.

### Why renumbering `mobile-dev`'s files is the wrong fix

Restoring `main`'s original filenames and moving `mobile_sessions.sql` /
`fix_mobile_session_rotation.sql` past the head fixes the `main`-fed lineage and
breaks the `mobile-dev`-fed one: there, `20260904000000` and `20260905000000`
are already recorded as the *mobile* migrations, so `bound_leave_reminder_text`
and `freeze_manager_id_own_update` would be skipped forever. That drops the
`manager_id` freeze policy — trading a security control for tidier filenames.
Neither renaming direction is safe for both lineages, because renaming can only
ever shift which lineage loses.

### The fix: one additive, idempotent migration

Add `supabase/migrations/20260905000001_ensure_mobile_sessions.sql`. Version
`20260905000001` is deliberately chosen to sit **after `main`'s head
(`20260905000000`)** and **before `20260905030000`**, which is the only window
that satisfies both constraints. It contains the table, its two indexes, `enable
row level security`, and the `revoke all … from public, anon, authenticated`
from `20260904000000_mobile_sessions.sql` — expressed idempotently
(`create table if not exists`, `create index if not exists`) and **without** the
`rotate_mobile_session` function, which `20260911000001` owns.

| Lineage | Behavior after the merge |
| --- | --- |
| Fresh / empty | `20260904000000` creates the table; `20260905000001` is a no-op; head reached. |
| Fed from `mobile-dev` | Table already exists. `20260905000001` is older than the recorded head, so `db push` skips it by default (it would be a no-op if forced with `--include-all`). Correct either way. |
| Fed from `main` | `20260904000000` / `20260905000000` skipped as already-recorded; `20260905000001` applies and creates the table; `20260905010000` / `20260905020000` re-apply `main`'s own SQL harmlessly; `20260905030000` and `20260911000001` now succeed. |

All three converge on the same schema with no `supabase migration repair` and no
edit to an already-pushed migration.

### Residual out-of-order item

`20260831101435_timesheets_backfill_window.sql` exists only on `main` and
survives the merge automatically. In a `mobile-dev`-fed database its version
predates the recorded head, so a default `db push` will skip it and the
PostgREST-level backfill policies on `public.timesheets` will be missing. It is
`drop policy if exists` + `create policy` throughout, so it is safe to force
with `--include-all`. Impact is limited to defense-in-depth — the Supabase
adapter writes through the service-role client, which bypasses RLS — but it
should be confirmed per environment rather than assumed.

Note also that this migration relies on `app_settings.backfill_mode`,
`backfill_window_days`, and `backfill_extra_days`, which come from
`20260813000000_app_settings.sql` and exist on both branches, so there is no
column dependency to resolve.

### What is already correct

`20260911000001_pin_mobile_session_rotation.sql` is post-head and version-unique
on both branches, so it applies exactly once in **every** lineage. It installs
the hardened `rotate_mobile_session` body (aliased/qualified references,
`set search_path = public, pg_temp`, `execute` granted to `service_role` only).
That deterministically resolves the long-standing "which function body is
actually live?" ambiguity documented in
[MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md](MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md)
— but only *after* the table exists, which is why M2 is a prerequisite and not
an optional cleanup. The audit's STOP gate on ad-hoc version selection is
respected: `20260905000001` is not an alternative rotation migration, it is a
table-existence precondition, and it must still be recorded against whatever
version-allocation process the release owner approves.

## Implementation slices

Each slice is a separate commit. Do not squash them: M1, M3, and the migration
in M2 all change runtime behavior and each must be independently revertible.

### M0 — decisions to record before touching code

Three, all blocking, all cheap:

1. **Version-allocation policy** for `20260905000001` (release owner). The
   migration history audit currently marks this `PENDING`; that gate is what
   stops M2, not the SQL.
2. **Does M3 land before the merge?** See §Recommendation. If deferred, record
   `MOBILE_BEARER_AUTH_ENABLED=false` as a hard release constraint.
3. **Which lineage does each environment actually have?** Fill the environment
   matrix in the migration history audit — every row is still `pending
   operator`. M2 is correct for all three lineages, so this is needed for
   verification and rollback planning, not to choose the fix.

### M1 — merge `origin/main` into `mobile-dev` (12 hunks, 8 files)

`git merge origin/main` on `mobile-dev`. Resolutions, in ascending risk:

| File | Hunks | Resolution |
| --- | --- | --- |
| `app/components/confirm.tsx` | 1 | **Take `main`.** It extracts `const unlocked = isConfirmUnlocked(confirmValue, typed)`; `HEAD` still inlines the expression. Same behavior, `main` is the refactor. |
| `app/dashboard/page.tsx` | 1 | **Combine.** Keep `main`'s `userId={profile?.id ?? user?.id}` *and* `HEAD`'s `initialUserId={selectedTeamUserId}`. Taking either side alone loses a feature. |
| `tests/actions-extra.test.ts` | 1 | **Keep `HEAD`'s imports** (`setRateLimitStore`, `resetLocalRateLimitWindows`, `createRateLimitFake`, `netHeld`) and port `main`'s new test onto the new fake. `main` imports `dailyWriteStore`/`todayISO`, which no longer exist. |
| `tests/supabase-daily-totals.test.ts` | 1 | **Keep `HEAD`.** Its `makeAdminClient` deliberately omits `upsert()` so a regression through the old path fails loudly; re-add `main`'s settings-fetch/`updateFn` expectations as an additional case. |
| `tests/supabase-migrations.test.ts` | 1 | **Keep `HEAD`** (the `reclassify_title_atomic` assertions and the `rotate_mobile_session migration approval gate (P1)` block at `:194`), then extend it in M2. |
| `lib/db/supabase.ts` | 2 | Imports: **union** (`DEFAULT_MOBILE_LAYOUT`, `normalizeBranding`, `todayISO`). `canEditAll`: **take `main`'s `isAdminActor(actor)`**, not `HEAD`'s `canSeeAllActor(actor)`. `main` is stricter and correct — a CO may *see* all rows but may edit only their own. |
| `app/actions/timesheets.ts` | 4 | **Take `main`'s backfill-window enforcement inside `HEAD`'s `withWriteBudget` closures.** Both sides changed the same lines for unrelated reasons; neither side alone is acceptable. |
| `lib/db/native.ts` | 1 | **Highest risk.** `HEAD` rewrote `bulkUpdateTimesheets` into a batched/set-based statement using `updatedIds`; `main` kept it per-row but added an `isAdminActor` scope and a backfill predicate `exists (select 1 from public.app_settings s …)` checking **both** `log_date` and `$3::date`. Port `main`'s predicate into `HEAD`'s batched statement. Do not resolve this by taking a side. |

#### The backfill-enforcement gap this closes

`main`'s `2a77608` added window checks that `mobile-dev` lacks. After M1 every
row below must hold, in both the action layer and the native SQL:

| Action | `mobile-dev` today | Required |
| --- | --- | --- |
| `logEntry` | new date checked | unchanged |
| `duplicateEntry` | source date checked | unchanged |
| `logYesterday` | checked | unchanged |
| `deleteLastEntry` | **no check** | `latest.log_date` in window |
| `updateTimesheet` | new `logDate` only | **both** `target.log_date` and the new date |
| `deleteTimesheet` | **no check** | `target.log_date` in window |
| `bulkUpdateTimesheets` | new `logDate` only | **both** dates |

Related: `supabase/migrations/20260906000000_bulk_update_timesheets_rpc.sql:41`
enforces ownership (`and (p_can_edit_all or t.user_id = p_actor_id)`) but has no
backfill predicate. Once the native path enforces both dates, the Supabase RPC
diverges. Track it as a parity item under slice 3 of the code-quality plan
rather than widening this merge.

Commit as `chore(merge): merge main into mobile-dev`, application code only — no
migration in this commit.

### M2 — `20260905000001_ensure_mobile_sessions.sql`

Blocked on M0.1. Contents: `create table if not exists public.mobile_sessions`
with the columns, FK, and `check (idle_expires_at <= absolute_expires_at)` from
`20260904000000_mobile_sessions.sql:5-21`; `create index if not exists` for
`mobile_sessions_user_active_idx` and `mobile_sessions_family_idx`; `alter table
… enable row level security`; `revoke all on table … from public, anon,
authenticated`. No function definition.

Extend `tests/supabase-migrations.test.ts` with assertions that the file exists
exactly once, that every statement in it is idempotent, that it declares no
`rotate_mobile_session`, and that its version sorts strictly between
`20260905000000` and `20260905030000` — that ordering is the whole point of the
file and a future rename would silently defeat it.

Commit separately as `fix(db): ensure mobile_sessions exists before dependent
migrations`, per the AGENTS.md rule that migrations never mix with application
code.

### M3 — scope the Supabase adapter's cross-user writes

Decided in M0.2. `lib/db/supabase.ts` obtains a service-role client via
`server()`, which returns `getAdminClient()` and therefore bypasses RLS
entirely. Six methods take `_actor` and never use it:

```
createLeaves(_actor, rows)      // inserts caller-supplied r.userId
deleteLeave(_actor, id)         // .delete().eq('id', id) — no owner predicate
listReminders(_actor, userId)   // filters by the caller's userId argument
createReminder(_actor, input)   // inserts input.userId unchecked
updateReminder(_actor, id, ...) // .eq('id', id) only
deleteReminder(_actor, id)      // .eq('id', id) only
```

`lib/db/native.ts` already implements all six correctly, so this is a port, not
a design task: `isAdminActor(actor)` bypass, otherwise `row.userId !== actor.id`
rejection for leaves and a hard `actor.id` substitution for reminders (native's
comment — "Reminders are own-only regardless of the passed userId" — is the
contract).

Reachability, no elevation required: `app/api/v1/leaves/route.ts:41`
(`createLeavesService(auth.actor, body)`), `app/api/v1/leaves/[id]/route.ts`
DELETE, `app/api/v1/reminders/[id]/route.ts` PATCH and DELETE, and
`app/api/data/leaves/route.ts` POST/DELETE. `lib/api/v1/services/leaves.ts`
passes `parsed.data` straight through, and `leaveRowsSchema` in
`lib/validation-schemas.ts` requires a client-supplied `userId`
(`z.string().min(1, 'userId is required.')`) that is never bound to the actor.

Add `tests/supabase-repository-authz.test.ts` with, per method, one authorized
call and one cross-user attempt. Extend `tests/native-repository.test.ts` only
where needed to lock the native behavior used as the parity contract. Keep
`writeError` hardening in slice 4 of `CODE_QUALITY_AUDIT_REMEDIATION_PLAN.md` so
this release-blocking authorization commit stays narrow and independently
revertible.

Commit as `fix(db): scope supabase leave and reminder writes to the actor`.

### M4 — environment prerequisites

`lib/rate-limit-subject.ts` throws when `RATE_LIMIT_SUBJECT_SECRET` is unset or
shorter than 32 characters. `lib/rate-limit.ts:234` calls
`hashRateLimitSubject(bucket, subject)` **outside** the `try` that begins at
`:240`, so the throw escapes `reserveRateLimit`. `app/api/auth/login/route.ts:31`
calls `reserveRateLimit('daily-login', …)` before any `try` of its own. The
result is a 500 on every login, signup, change-password, forgot-password, and
reset-password request, plus every Server Action write budget via
`app/actions/_shared.ts` → `reserveWriteBudget`.

Before merging, set in **every** target environment:

- `RATE_LIMIT_SUBJECT_SECRET` — ≥32 characters, distinct per environment.
- `CRON_SECRET` — required by the new `vercel.json` schedule
  (`*/15 * * * *` → `/api/v1/cron/cleanup`).
- `TRUSTED_PROXY_HOPS` — set to the actual proxy chain length; do not copy `1`
  to deployments with a CDN/WAF in front of the ingress.
- `MOBILE_BEARER_AUTH_ENABLED` — explicitly `false` if M3 was deferred.

Optionally, move the `hashRateLimitSubject` call inside the existing `try` so a
misconfiguration degrades rather than 500s. That is a real improvement but it
converts a loud failure into a quiet one, so it should be a deliberate decision
with a startup-time configuration check alongside it — not a silent softening.

### M5 — make CI exercise the checks it currently skips

This is not a prerequisite for resolving the Git conflicts, but it is a release
readiness gate for a merge of this size.

- In `.github/workflows/ci.yml`, expose the seeded admin as `E2E_EMAIL` and
  `E2E_PASSWORD` in `native-e2e` so `e2e/smoke.spec.ts` executes the authenticated
  dashboard/login/logout path.
- Set `TEST_DATABASE_URL` to the job's PostgreSQL service URL and run
  `npm run db:concurrency-test` after migrations. Confirm the test executes
  rather than reporting a skip.
- Decide whether to seed and export `E2E_PENDING_EMAIL` /
  `E2E_PENDING_PASSWORD`; if not, explicitly document
  `e2e/pending-nav.spec.ts` as a local/manual check.
- Keep the existing `container-build` job. Because Docker was unavailable in
  the review environment, its successful CI run is required evidence before
  release.
- Update `docs/security/SECURITY_REVIEW.md`: remove the stale statement that no
  in-repo `vercel.json` exists, retain `Status: Open`, and record the still-open
  live Vercel/HSTS verification separately.

Commit CI wiring separately as `test(ci): execute database and authenticated e2e checks`.

### M6 — final integration merge

After M0–M5 and all acceptance gates pass, run
`git checkout main && git merge --no-ff mobile-dev`. Use a merge commit, not a
squash: M1, M2, M3, and M5 have different rollback characteristics, and the
authorization-changing commits must remain individually revertible as required
by `CODE_QUALITY_AUDIT_REMEDIATION_PLAN.md`.

## Impacted components

| Area | Files | Planned change |
| --- | --- | --- |
| Merge reconciliation | `app/actions/timesheets.ts`, `app/components/confirm.tsx`, `app/dashboard/page.tsx`, `lib/db/native.ts`, `lib/db/supabase.ts` | Resolve the 8-file/12-hunk merge without dropping `main`'s three correctness/security fixes or `mobile-dev`'s rate-limit/mobile work. |
| Conflict tests | `tests/actions-extra.test.ts`, `tests/supabase-daily-totals.test.ts`, `tests/supabase-migrations.test.ts` | Combine both branches' assertions against the current test helpers. |
| Required upstream additions | `app/dashboard/entries-table.tsx`, `tests/actions.test.ts`, `tests/confirm.test.ts`, `tests/native-repository.test.ts`, `tests/supabase-whitelisted-domain.test.ts`, `supabase/migrations/20260831101435_timesheets_backfill_window.sql` | Preserve non-conflicting files from `main` and verify their tests still execute. |
| Migration reconciliation | `supabase/migrations/20260904000000_mobile_sessions.sql`, `supabase/migrations/20260905000000_fix_mobile_session_rotation.sql`, `supabase/migrations/20260905010000_bound_leave_reminder_text.sql`, `supabase/migrations/20260905020000_freeze_manager_id_own_update.sql`, `[NEW] supabase/migrations/<approved>_ensure_mobile_sessions.sql`, `docs/plans/MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md` | Record live lineage, obtain the version-policy decision, and add the approved idempotent bridge without altering applied SQL. |
| Authorization | `lib/db/supabase.ts`, `[NEW] tests/supabase-repository-authz.test.ts`, optionally `tests/native-repository.test.ts` | Make leave/reminder operations actor-scoped and lock parity with native behavior. |
| Deployment | `.env.example`, `deploy/configmap.yaml`, `deploy/secret.yaml`, `deploy/README.md`, `vercel.json` | No secret values committed; verify required variables are documented and provisioned out of band per environment. |
| CI and evidence | `.github/workflows/ci.yml`, `e2e/smoke.spec.ts`, `tests/daily-hours-concurrency.int.test.ts`, `docs/security/SECURITY_REVIEW.md` | Turn currently skipped integration/authenticated checks into required CI evidence and correct stale documentation. |

## Verification

Run on the merge result, from the repository root — not from `mobile/`, since
the root scripts are not visible there:

```bash
npm run lint && npm run typecheck && npm test && npm run test:coverage
```

```bash
NEXT_PUBLIC_BACKEND=supabase npm run build
```

```bash
NEXT_PUBLIC_BACKEND=native DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/vsis AUTH_SECRET=placeholder-secret-at-least-32-chars-long npm run build
```

```bash
cd mobile && npm run lint && npx tsc --noEmit && npm test
```

Targeted suites for the slices above:

```bash
npx vitest run tests/supabase-migrations.test.ts tests/supabase-daily-totals.test.ts tests/actions-extra.test.ts tests/supabase-repository-authz.test.ts
```

Database-backed verification, on a migrated disposable PostgreSQL database:

```powershell
$env:TEST_DATABASE_URL='<disposable-test-database-url>'
npm run db:concurrency-test
```

Build-matrix verification in PowerShell:

```powershell
$env:NEXT_PUBLIC_BACKEND='supabase'
npm run build
$env:NEXT_PUBLIC_BACKEND='native'
$env:DATABASE_URL='postgres://placeholder:placeholder@localhost:5432/vsis'
$env:AUTH_SECRET='placeholder-secret-at-least-32-characters'
$env:RATE_LIMIT_SUBJECT_SECRET='placeholder-rate-limit-secret-at-least-32-characters'
npm run build
```

For Supabase, use a disposable clean project first, then a snapshot restored
from each lineage identified in M0. Record `supabase migration list`, table
existence, the `rotate_mobile_session` function definition/security/grants, and
the backfill policies before and after `supabase db push`. Do not use
`supabase migration repair` unless the recorded schema/history matrix proves it
is necessary and the release owner approves the exact operation.

## Acceptance gates

The merge is ready only when all of the following are true:

1. `origin/main`'s three commits are ancestors of the prepared branch, all 12
   conflict hunks are resolved, and
   `20260831101435_timesheets_backfill_window.sql` is present.
2. The release owner has recorded the migration-version policy and every target
   environment has a completed backup/history/live-schema row in
   `MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md`.
3. A clean Supabase database and each discovered historical lineage reach the
   same schema; `mobile_sessions` exists before dependent migrations and the
   hardened rotation function is executable only by `service_role`.
4. Non-admin cross-user leave/reminder create, list, update, and delete attempts
   fail in Supabase mode; legitimate own-user operations and the documented
   admin leave behavior continue to work.
5. `RATE_LIMIT_SUBJECT_SECRET`, `CRON_SECRET`, and the correct
   `TRUSTED_PROXY_HOPS` are provisioned in every deploy target. Bearer auth stays
   disabled until M3 and the live migration checks pass.
6. Root lint/typecheck/unit/coverage, both backend builds, mobile lint/typecheck/
   tests, the database integration test, authenticated Playwright smoke test,
   and Docker build are green without unexpected skips.
7. `git diff --check` is clean; `git status --short` contains only intended
   changes; the final integration uses `git merge --no-ff mobile-dev` and is not
   squashed.

## Explicitly deferred follow-ups

The broader `_actor` sweep, `server()` flip, error-message hardening, coverage
expansion, and `SessionProvider` decomposition remain in
`CODE_QUALITY_AUDIT_REMEDIATION_PLAN.md`. They are not bundled into this merge
except for the release-blocking leave/reminder slice, keeping the remediation
reviewable and rollback-safe.

### Manual and live verification

Verification that unit tests cannot provide, and must therefore be run
deliberately:

- **Backfill enforcement (M1).** Set a narrow window, then attempt
  `deleteLastEntry`, `deleteTimesheet`, `updateTimesheet` on an out-of-window
  row, and a `bulkUpdateTimesheets` batch that mixes in-window and out-of-window
  rows. Assert per-row rejection, not batch-level. Run in **both** backend
  modes; the native and Supabase paths enforce this in different places.
- **Migration convergence (M2).** Apply the full history to a scratch database
  seeded to each of the three lineages in §Migration convergence. The `main`-fed
  case is the one that currently fails at `20260905030000`; it is the only proof
  that matters.
- **`docker build`.** Not run for this plan. Run it, or accept CI as the gate.
- **Live `rotate_mobile_session` probe.** Confirm owner, `prosecdef`,
  `search_path`, and grants after the push, and exercise one refresh rotation
  plus one reuse attempt against the real RPC. Record the outcome in the
  migration history audit's environment matrix without retaining token material.

## Rollout and recovery

Order matters: **environment variables → database → application.**

1. Set the M4 variables everywhere. This is safe ahead of the deploy: the
   current code ignores them where they are not yet required.
2. Take a recoverable snapshot of each target database. `20260905000001` creates
   a table and `20260905010000`/`20260905020000` re-apply policies; all are
   idempotent, but the snapshot is what makes step 3 reversible.
3. `supabase db push` per environment, lowest first. Expect
   `20260905000001_ensure_mobile_sessions.sql` to apply on `main`-fed databases
   and to be skipped on `mobile-dev`-fed ones. If a `mobile-dev`-fed database
   also needs `20260831101435`, push with `--include-all` and re-verify.
4. Deploy the application.
5. Enable `MOBILE_BEARER_AUTH_ENABLED` only where M3 has shipped.

Recovery:

- **Application-level regression** — revert the individual commit. This is the
  reason for four commits instead of one squash.
- **Migration failure** — the schema changes are additive and idempotent, so a
  re-push after fixing the cause is safe. A failed `20260905030000` means M2 was
  skipped or misordered; check `supabase_migrations.schema_migrations` for
  `20260905000001` before doing anything else.
- **Auth outage right after deploy** — check `RATE_LIMIT_SUBJECT_SECRET` first.
  It is the only new variable whose absence produces a blanket 500 on every
  authentication route.

## Out of scope

Deliberately excluded so the merge stays reviewable. Each is already tracked.

- Slices 4–8 of
  [CODE_QUALITY_AUDIT_REMEDIATION_PLAN.md](CODE_QUALITY_AUDIT_REMEDIATION_PLAN.md):
  error hygiene and the `AUTH_SECRET` minimum, the `server()` flip,
  coverage-scope expansion, and the 2,088-line
  `mobile/src/auth/SessionProvider.tsx` decomposition. Only slice 1 is pulled
  forward, as M3, and only because the merge changes its reachability.
- The four read-path parity divergences named in that plan's slice 3
  (`listTimesheets`, `listLeaves`, `listProfiles`,
  `countTimesheetsByProject`). They are read-only; M3 covers the writes.
- Adding a backfill predicate to
  `20260906000000_bulk_update_timesheets_rpc.sql`. Real, but it is a parity item
  that would widen this merge into an RPC change.
- The six open items in
  [../security/SECURITY_REVIEW.md](../security/SECURITY_REVIEW.md). One
  incidental correction belongs there: its claim that "there is no in-repo
  `vercel.json`" is now stale.
- Any renaming of already-pushed Supabase migrations, per §Migration
  convergence.

## Assumptions and stop conditions

Assumptions, each falsifiable:

- `origin/main` is at `2a77608` and `mobile-dev` at `1b4f226`. Re-run the
  conflict enumeration if either moved — the 12-hunk table is a snapshot.
- `supabase_migrations.schema_migrations` in each environment matches one of the
  three lineages in §Migration convergence. M0.3 confirms this.
- `check_function_bodies` is at its default `on`. If an environment disables it,
  `20260911000001` would succeed without the table and fail later at call time
  instead — the fix is unchanged, the failure mode is worse.
- The Supabase adapter's authorization hole is pre-existing. Verified
  byte-identical on `origin/main`; the merge adds reachability, not the defect.

Stop conditions — halt and escalate rather than working around:

- **No recorded version-allocation decision.** M2 does not proceed on an ad-hoc
  timestamp; that is precisely what the migration history audit's STOP gate
  forbids.
- **An environment cannot be classified or lacks a recoverable snapshot.** Do
  not infer migration lineage from version numbers alone.
- **A `20260905030000` failure after M2 applied.** Means the lineage model is
  wrong, not that the migration needs patching.
- **A conflict resolution that requires changing behavior neither branch had.**
  Only `lib/db/native.ts`'s `bulkUpdateTimesheets` legitimately needs new code
  (`main`'s predicate inside `HEAD`'s batched statement). Anywhere else, that is
  a signal the resolution is wrong.
- **`MOBILE_BEARER_AUTH_ENABLED=true` requested without M3.** Non-negotiable:
  that combination makes unscoped cross-user leave and reminder writes reachable
  from any authenticated mobile client.
- **Required secrets are absent/short, the proxy hop count is unknown, or an
  expected CI integration/e2e test skips.** Stop release rather than treating a
  partial green run as evidence.






