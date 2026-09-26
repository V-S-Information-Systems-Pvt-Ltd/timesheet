# Architecture Simplification Plan

## Context

VSIS Timesheet is a Next.js 16 App Router timesheet app with two interchangeable
backends (`supabase` default, `native` self-hosted PostgreSQL) plus a React Native
client. It is ~121k LOC / 585 files.

Over the last two months (394 commits) the repository absorbed a large Supabase↔native
**data-migration programme** (checkpoints C00–C10). That programme is genuinely
valuable, but it has grown to roughly a fifth of the codebase, it is incomplete
(C06B BLOCKED, C07 IN PROGRESS, C08 NOT STARTED), and it has leaked into the runtime
request path. Meanwhile an earlier and *successful* refactor — moving every domain onto
narrow persistence ports — left its predecessor, the broad `Repository` facade, in place
as dead scaffolding still maintained, tested and held in dual-backend parity.

The result is a **complexity multiplier**: two persistence adapters × a bidirectional
migration tool between them × parity tests × a doubled CI matrix. Nobody has removed the
parts that are provably no longer load-bearing.

**Two decisions reshape the plan** (previously this question was open, which gated the
whole second half):

1. **Dual-backend is transitional — `native` is the survivor.** Supabase is the migration
   *source* and retires after cutover. (Product decision, user-confirmed 2026-09-23; it was
   open when the second half of this plan was first drafted.)
2. **Client→server consolidates onto `/api/v1`** — the browser's remaining three surfaces
   retire in its favour. Aggressive consolidation is authorized.

**The governing principle that follows from decision 1:** every Supabase-side artifact is
now *scheduled for deletion*. So Phases 1–3 must stop investing in Supabase parity — no new
Supabase adapter work, no new Supabase parity tests — and their sequencing goal changes
from "safe under either future" to **"shrink the eventual Supabase deletion surface and
remove everything standing between here and it."**

It is explicitly **not** a line-count exercise. `docs/plans/OVERENGINEERING_REMEDIATION_PLAN.md`
(2026-09-19) already correctly rejected a previous LOC-driven proposal, and its standard of
evidence is adopted here. Note that its central caveat — *"if retiring Supabase replay becomes
a product requirement, first record current capability settings and migration state for every
deployment, specify mobile queue behavior, then use additive migrations and a staged
rollout"* — is **now triggered**, and Phase 4 is written to satisfy it.

### Decisions taken into this plan

| Question | Answer | Consequence |
| --- | --- | --- |
| Is dual-backend permanent? | **No — transitional; `native` survives** | Supabase retires. Phase 4 is no longer gated on an open question; it is *sequenced after the C09/C10 cutover*. |
| Migration tooling? | **Keep, but isolate — and schedule its retirement** | Move out of `lib/`, de-leak from the request path, own CI job. It is a one-way off-ramp with a known end date (C10 close), not a permanent fixture. |
| Behaviour-change appetite? | **Aggressive consolidation allowed** | Retiring three client→server surfaces and a coordinated `/api/v1` change are in scope. |

---

## Evidence

All findings re-verified 2026-09-26 against `e4be0d2` (`arch/dual-backend-modular-implementation`,
open as PR #8). The first draft was measured at `675abe8`; the re-measurement is reported below
where it moved, because the direction of travel is itself evidence.

### F1 — The broad `Repository` dispatcher is vestigial

The narrow-port refactor is **already complete**. Every domain has a port and a small
composition module:

```
lib/domain/{timesheets,people,reference,operations,leave-reminders,workspace,reporting}-port.ts
lib/db/{timesheets,people,reference,operations,leave-reminders,workspace,reporting}.ts   (25–52 lines each)
```

`lib/db/timesheets.ts:16` states the intent outright: *"Bypasses the broad compatibility
Repository facade so domain operations talk directly to their provider implementation."*

What remains of the predecessor:

| File | Lines | Status |
| --- | --- | --- |
| `lib/db/repository.ts` | 472 | Lines 36–236 are types + `requireActive`/`requireRole`, imported **widely**. Lines 242–472 are the `Repository` interface — vestigial. |
| `lib/db/native.ts` | 400 | Pure pass-through to `native/*`. **One exception:** `findWhitelistedDomain` (~358–368) has real SQL. |
| `lib/db/supabase.ts` | 409 | Mirror image, same single exception (~366). |
| `lib/db/index.ts` | 20 | Exports the `repo` dispatcher. |

The `repo` dispatcher has **exactly two live call sites in the whole application** —
`lib/rate-limit.ts:132-133` (`reserveRateLimit`, `releaseRateLimit`), both of which already
delegate to `{native,supabase}OperationsPersistence`.

`tests/boundary-enforcement.test.ts` **already forbids** `app/actions/**`, `app/api/**` and the
domain composition modules from importing `@/lib/db` (lines 275, 347). The dispatcher is not
merely unused — it is *already architecturally prohibited* everywhere except `lib/rate-limit.ts`.

**Cost of keeping it:** ~1,050 dead lines, plus two more files that must be deleted carefully in
Phase 4 instead of wholesale.

### F2 — Migration tooling is a fifth of the repo and leaks into the request path

| Area | Size (2026-09-26) | Since `675abe8` |
| --- | --- | --- |
| `lib/migration/` (incl. `providers/`) | 20 files, **11,881 lines** | unchanged |
| `tests/migration-*` | 30 files, **13,606 lines** | +1 file, **+447 lines** |
| **Total** | **~25,500** | **+447 in 3 days** |

**The growth rate is the argument for Phase 0.** In the three days between the two measurements
the repository added 4,384 lines, essentially all of it migration work (`migration-fence.test.ts`
+496, `migration-provider-fence.int.test.ts` +414, two new `supabase/migrations/`, plus mobile
offline-queue changes). None of it is wrong — but it is continued investment in a subsystem that
is scheduled to be deleted, and it compounds daily until the decision in Phase 0 is written down.

It is an **operator CLI**, reached only through `scripts/migrate-backend.ts` (`npm run migration`).
`tests/boundary-enforcement.test.ts:369,391` already enforces that application code cannot import
it and that it cannot import request-bound modules. Architecturally it is already a separate tool
— it is just filed inside `lib/`, so it inherits the app's coverage gates, lint config, tsconfig
and CI wiring.

Two real leaks into runtime remain:

1. **`lib/idempotency.ts` (1,424 lines, was 1,393).** Roughly **590 lines** are migration-era logic
   (`PortableRetryRow`, `readPortableRetryRows`, `decidePortablePayload`, `applyPortableTranslation`,
   `classifyPortablePayload`, `remapPortablePayload`, `resolvePortableRetry`, `readLegacyStampedLedger`,
   …; 59 occurrences of "portable"). These issue direct `migration_record_map` reads from the
   **hot path of every idempotent mobile write** — now **six** call sites, native SQL and Supabase
   PostgREST in pairs, at lines 524/543, 560/578, 736/754. `withIdempotency` is the entry point
   every `/api/v1` mutation passes through.
2. **`lib/db/write-gate.ts` (138 lines).** Reads `public.migration_write_gate` on every write path
   in both backends. Defensible while a cutover is pending, but it is currently permanent
   infrastructure for a temporary event, **with no removal trigger recorded anywhere**.

### F3 — Dual-backend parity is enforced by duplication, not by sharing

Adapter pairs, by domain (native vs supabase lines):

| Domain | native | supabase |
| --- | --- | --- |
| timesheets | 486 | 596 |
| reference | 384 | 419 |
| people | 327 | 347 |
| operations | 495 | 326 |
| leave-reminders | 228 | 416 |
| workspace | 171 | 181 |
| reporting | 175 | 117 |
| **Total** | **2,266** | **2,402** |

Plus `lib/supabase/*` (702, of which `database.types.ts` is 527 generated) and two migration
trees: `db/migrations/` (36 files) and `supabase/migrations/` (70 files). 21 files read the
backend selector. CI doubles `build` and `e2e` across both backends.

**This is the Phase 4 deletion inventory.**

### F4 — Four overlapping client→server surfaces, and they already share the domain

| Surface | Files | Route handlers |
| --- | --- | --- |
| `app/actions/` (Server Actions) | 8 files, 1,202 lines + 183-line facade | 63 exported actions |
| `app/api/data/` (compatibility reads) | 12 | 12 |
| `app/api/auth/` (web cookie auth) | 9 | 9 |
| `app/api/v1/` (versioned; mobile + browser) | 41 | 41 |

Two guard modules implement overlapping logic: `app/api/_http.ts` (115 lines) and
`app/api/v1/_http.ts` (466 lines). They share only `originCheck`; they **duplicate** actor
checks, `SAFE_METHODS`, `json`/`serverError`, and the write-fence refusal (identical literal at
`_http.ts:111` / `v1/_http.ts:149`).

**The load-bearing finding:** Server Actions and `/api/v1` services *already sit on the same
domain layer* — both import `@/lib/db/*` composition and `@/lib/domain/*` directly, and **no
action imports a v1 service or vice versa**. There is no business-logic duplication to
reconcile. Phase 3 is a **transport, validation and envelope consolidation over an
already-shared domain** — not a logic port. That is the single biggest de-risking fact in this
plan.

Supporting detail:

- `lib/data/client.ts` already routes **timesheets** through `/api/v1` (line 209) but the other
  ~17 reads/writes still target `/api/data/*` (projects, profiles, profile, backfill-window,
  activity-types, leaves ×3, reminders ×4, global-reminders ×2, reports).
- `/api/v1` is a near-superset. The two apparent gaps both close: `/api/data/backfill-window`
  → `/api/v1/admin/settings/backfill`; `/api/data/profile` → `/api/v1/auth/me`.
- 16 dashboard components import actions via the **relative** path `'../actions'`
  (`app/dashboard/*.tsx`). They do **not** use `useActionState`, `useFormState`, or the
  `action={…}` form prop — every call is an imperative invocation, which is what makes the
  move to `fetch` mechanical.
- Six raw `fetch` calls bypass `lib/data/client.ts`: `app/reports/page.tsx:289,298,307,317,338`
  and `app/dashboard/backup-panel.tsx:51`.
- `revalidatePath('/', 'layout')` appears **twice**, both in `app/actions/settings.ts`
  (lines 226, 237). This is the one genuine capability at risk in Phase 3 (see below).
- The `restoreBackup` **Server Action** is dead (`app/actions/import-backup.ts:183-205`, facade
  `app/actions.ts:137`), and so is `app/api/data/timesheets/route.ts` (tests-only caller).
  **These are the only two dead units — see F5 before deleting anything else.**

### F5 — Two blockers that invert the order of Phase 3

Both were missed in the first draft and both are load-bearing.

**(a) `/api/data/backup/restore` is live and has no `/api/v1` equivalent.**
The first draft established that the `restoreBackup` *Server Action* is dead and then treated the
whole `app/api/data/` tree as deletable. Those are two different code paths to the same capability.
The **route** is live: `app/dashboard/backup-panel.tsx:51` fetches it directly, and
`tests/backup-restore-route.test.ts` covers it. `find app/api/v1 -ipath '*backup*'` returns nothing.
Deleting `app/api/data/` as written **breaks database restore**. A v1 route must be built first.

**(b) Only 5 of 42 `/api/v1` routes accept a cookie — and the browser has no bearer token.**

```
allowCookie: app/api/v1/timesheets{,/[id],/[id]/duplicate,/batch-delete,/batch-duplicate}
bearer-only: the other 37 routes
```

`withMobileActor` takes the bearer branch whenever an `Authorization` header is present and
otherwise returns `AUTH_REQUIRED` **unless the route opted in via `allowCookie`**
(`app/api/v1/_http.ts:378-400`). This is precisely why `lib/data/client.ts` already routes
timesheets — and only timesheets — through `/api/v1`. So Phase 3's "repoint the client" step is
**not** the low-risk opener the first draft called it: it is blocked until cookie auth is extended
across the v1 surface. **The guard-unification step is a prerequisite, not a follow-on.**

*The de-risking half of this finding:* extending `allowCookie` does **not** weaken CSRF. The v1
guard already imports `originCheck` from `app/api/_http.ts` (line 10) and applies it to every
non-safe cookie request (line 315), so CONSTRAINTS.md #8 is satisfied by construction on the path
being widened. The work is opt-in flags plus tests, not new security machinery.

**Also confirmed (a genuine win):** `/api/v1/reference` returns projects, activity types **and**
titles in one response (`lib/api/v1/services/reference.ts:13-28`), so it collapses two
`/api/data` round-trips into one.

---

## Plan

Five phases. **Phase 0 unblocks everything; Phases 1–3 are correct under the native-survives
decision and each one shrinks the Phase 4 deletion surface; Phase 4 is sequenced after the
existing C09/C10 cutover and gets its own document.**

### Phase 0 — Record the decision (do first; cheap, and stops further Supabase investment)

The migration ledger still lists **"first production direction" as an unanswered BLOCKED item
at C00**, even though the destination is already implied twice in the repo — the ledger itself
records *"the reserved recovery destination is a native PostgreSQL instance"*
(`docs/plans/SUPABASE_NATIVE_MIGRATION_NOTES.md:440`) and the C08 runbook reverse-migrates into
*"the reserved empty native recovery destination"* (`docs/plans/C08_REHEARSAL_RUNBOOK.md:79`).

1. Record `native` as the first production direction in the C00 ledger and resolve that BLOCKED
   item, so the programme's own record matches the decision this plan executes.
2. Add an ADR under the `docs/ai-context/ADR_INDEX.md` convention recording *"dual-backend is
   transitional; native is the survivor; Supabase is a migration source that retires"* — because
   until this exists, every contributor keeps paying for Supabase parity.
3. From this point, **reject new Supabase-parity work** (new Supabase adapters, new
   `supabase/migrations/`, new `tests/supabase-*.test.ts`) except where the cutover itself needs it.

### Phase 1 — Retire the vestigial `Repository` dispatcher

Removes ~1,050 dead lines. Both backends keep working (the Supabase deployment is still live
until C10), so only the *facade layer* goes.

1. **Split `lib/db/repository.ts` → `lib/db/types.ts`.** Keep everything at lines 36–236
   (`Actor`, `DbWrite`, `DbResult`, `DbCreateResult`, `TimesheetInput`, `TimesheetListOptions`,
   `BulkTimesheetUpdate`, `ReportBucket`, `requireActive`, `requireRole`, …) — imported by ~25
   files and must keep working. Drop the `Repository` interface (lines 242–472). Re-export from
   the old path for one commit so the change is reviewable, then remove the shim.
2. **Relocate the one non-delegating method.** Move `findWhitelistedDomain`
   (`lib/db/native.ts:~358`, `lib/db/supabase.ts:~366`) into
   `nativeReferencePersistence` / `supabaseReferencePersistence`. This is the only non-pass-through
   method in either facade, and doing it now means Phase 4 deletes `supabaseReferencePersistence`
   cleanly instead of untangling a facade.
3. **Add `lib/db/rate-limits.ts`** (~15 lines) following the `lib/db/timesheets.ts:16-20` pattern
   exactly: `IS_NATIVE ? nativeOperationsPersistence : supabaseOperationsPersistence`, exposed as
   the `RateLimitStore` that `lib/rate-limit.ts:113` **already defines**. Point `activeStore()`
   (`lib/rate-limit.ts:128-135`) at it — this removes the last `repo` consumer.
4. **Delete** `lib/db/native.ts`, `lib/db/supabase.ts`, and the `repo` export from `lib/db/index.ts`.
5. **Re-point 15 test files** from `nativeRepository` / `supabaseRepository` to the per-domain
   adapters. Mechanical (the facades are pass-throughs), but it is the bulk of the work and must
   preserve every authorization assertion: `tests/native-repository.test.ts` (45 refs),
   `tests/supabase-repository-authz.test.ts` (35), `tests/supabase-daily-totals.test.ts` (26),
   `tests/idempotency-stamp-recovery.test.ts` (20), `tests/operations-restore.int.test.ts` (10),
   and 10 smaller files. **Do not delete or weaken these** — they carry the authorization-parity
   coverage that guards the still-live Supabase deployment.
6. **Tighten `tests/boundary-enforcement.test.ts`** so the dispatcher cannot return: the rules at
   lines 275 and 347 become repo-wide.

*Not in scope:* the per-domain adapters themselves, and the `Actor`/guard types.

### Phase 2 — Isolate the migration tooling, and schedule its retirement

Does not reduce migration capability while the cutover is still running. Its purpose is to make
the tooling **removable** when that ends.

1. **Move `lib/migration/` → `tools/migration/`** as its own workspace package (add `tools/*` to
   the root workspace, or place it at `packages/migration`). Move `scripts/migrate-backend.ts`
   with it and keep `npm run migration` working unchanged. Update the two boundary rules
   (`tests/boundary-enforcement.test.ts:369,391`) to the new path — they already encode exactly
   the right constraint.
2. **Extract the portable-retry logic out of `lib/idempotency.ts`.** Move lines ~410–996 behind a
   narrow seam — e.g. `lib/idempotency/portable-retry.ts` exposing one `resolvePortableRetry(...)`
   port that `withIdempotency` calls, with a no-op default. Two benefits: `withIdempotency` becomes
   readable again (1,393 → ~800 lines), and the cross-backend remapping becomes **a single removable
   file** rather than surgery inside the hot path of every idempotent write. Keep
   `tests/migration-portable-classification.test.ts` and `tests/migration-retry-history.test.ts`
   green against the new seam.
3. **Give the migration suites their own CI job.** They are already gated by `MIGRATION_TEST_REQUIRE`;
   today they run inside the app's `lint-test` and `e2e` jobs and their files sit inside the `lib/**`
   coverage scope (`vitest.config.mts:31`). Excluding `tools/migration/**` from the app coverage scope
   makes the app's real coverage legible.
4. **Record the removal trigger** — for `lib/db/write-gate.ts` and for the tooling as a whole.
   Do not remove them yet. Write down: the trigger is **C10 close**; what gets deleted is
   `lib/db/write-gate.ts` + its callers in `app/api/_http.ts` / `app/api/v1/_http.ts`, the
   `migration_*` tables and their migrations, and `tools/migration/`. Currently no such trigger
   exists anywhere, which is why a temporary fence is quietly permanent.

### Phase 3 — Consolidate the client→server paths onto `/api/v1`

Target: **four surfaces → one**, plus one guard. The domain layer is already shared (F4), so this
is transport, validation and envelope work. Stage it so each step is independently shippable.

**Order corrected per F5:** the first draft opened by repointing the client. That step is blocked
until the v1 surface accepts cookies, so guard work now comes first. Steps 1 and 2 below carry no
user-visible change and can land independently; nothing is deleted before step 6.

1. **Unify the two guards, and widen the cookie path.** Fold `app/api/v1/_http.ts` onto
   `app/api/_http.ts` for the shared pieces — `originCheck`, one actor-check path, one
   `SAFE_METHODS`, one `json`/`serverError`, one write-fence refusal (the literal is currently
   duplicated at `_http.ts:111` and `v1/_http.ts:149`). Then set `allowCookie` on the v1 routes the
   browser needs: `reference`, `people`, `auth/me`, `leaves{,/[id]}`, `reminders{,/[id]}`,
   `reminders/global`, `reports{,/export}`, `admin/settings/backfill`. CSRF is inherited, not
   re-implemented (F5b). **Each route gets a cookie-auth test before it is repointed.**
2. **Add `/api/v1/admin/backup/restore`** covering what `app/api/data/backup/restore` does today,
   and port `tests/backup-restore-route.test.ts` onto it. Without this, step 6 destroys the restore
   capability (F5a). Keep it admin-gated exactly as the current route is.
3. **Repoint `lib/data/client.ts` onto `/api/v1`** — now unblocked. `projects` +
   `activity-types` → a single `/api/v1/reference` call (two round-trips become one),
   `profiles` → `/api/v1/people`, `profile` → `/api/v1/auth/me`, `leaves` → `/api/v1/leaves`,
   `reminders` → `/api/v1/reminders`, `global-reminders` → `/api/v1/reminders/global`,
   `reports` → `/api/v1/reports`, `backfill-window` → `/api/v1/admin/settings/backfill`.
4. **Absorb the six raw `fetch` bypasses** into that same client:
   `app/reports/page.tsx:289,298,307,317,338` and `app/dashboard/backup-panel.tsx:51` (the last one
   moves to the step-2 route). The reports page already shares a `runExport` helper — the wrappers
   only differ by date range, filter and filename, so this is small.
5. **Move the 16 dashboard components off `'../actions'`** onto client calls. These are imperative
   invocations (no `useActionState` / `useFormState` / `action={…}` anywhere), so the conversion is
   mechanical: swap the import for a `lib/data/client.ts` call, and translate the `{ error }` return
   into the client's error shape. Do it **domain by domain** — timesheets, then projects, then
   users, then settings, then superadmin, then import-backup — keeping the action as a thin shim
   until its last caller is gone, then delete it.
   - **The one behaviour to preserve deliberately:** `revalidatePath('/', 'layout')` in
     `app/actions/settings.ts:226,237` (verified: exactly two sites repo-wide). Route handlers may
     call `revalidatePath`, so this survives — but it must be added explicitly to the replacement
     settings route, or settings changes will stop refreshing the layout. Cover it with a test.
6. **Delete** once all of the above lands: `app/api/data/` (12 routes — safe only after steps 2–4),
   `app/api/auth/` (9 files, superseded by `/api/v1/auth/*`), and `app/actions.ts` + `app/actions/`
   (which takes the dead `restoreBackup` action with it).
7. **Tighten the boundary rules** to forbid a new `/api/data` or `/api/auth` route and a new Server
   Action, the same way Phase 1 does for the dispatcher.

**Sequencing caveat:** the action→route and `/api/data`→`/api/v1` moves are *server-internal* and
present the same wire shapes, so they need no mobile release. A mobile release is only required if
step 1–2 change a **released `/api/v1` DTO** — avoid that; add fields rather than rename them.

### Phase 4 — Retire Supabase (sequenced after C09/C10; own document)

**Precondition:** the C09 (cutover) and C10 (observation close) checkpoints complete, and Phase 0
has recorded the direction. Then this becomes `docs/plans/SUPABASE_RETIREMENT_PLAN.md`.

The deletion inventory, assembled from F3:

| Target | Size |
| --- | --- |
| `lib/db/supabase/*` | 2,402 |
| `lib/supabase/*` | 702 (527 generated) |
| `supabase/migrations/` | 70 files |
| `lib/db/supabase.ts` | already gone after Phase 1 |
| Supabase effect path + `runSupabaseStampedDelivery` (`lib/idempotency.ts:1261`), `DURABLE_IDEMPOTENCY_ENABLED` | — |
| Supabase auth (`lib/auth/supabase.ts`, `registration-supabase.ts`, `supabase-mobile-password.ts`, `lib/supabase/bearer.ts`) | — |
| `tools/migration/` + `lib/db/write-gate.ts` + `migration_*` tables | Phase 2 trigger |
| `tests/supabase-*.test.ts` | — |
| CI: collapse `build` ×2 → 1 and `e2e` ×2 → 1 | — |

**Preconditions this phase must satisfy**, taken verbatim from the standing guidance in
`docs/plans/OVERENGINEERING_REMEDIATION_PLAN.md:61-66` now that its trigger has fired:

1. Record current capability settings (`DURABLE_IDEMPOTENCY_ENABLED`, `NEXT_PUBLIC_BACKEND`) and
   migration state **for every deployment**.
2. **Specify mobile queue behaviour.** `lib/auth/mobile-config.ts` advertises durable replay for
   native always and Supabase only when `DURABLE_IDEMPOTENCY_ENABLED=true`;
   `mobile/src/auth/SessionProvider.tsx` gates queued replay on that capability. Removing the
   Supabase effect path changes behaviour for any deployment with the flag enabled, so the mobile
   queue contract must be stated and a **coordinated mobile release** scheduled.
3. Use **additive migrations** and a staged rollout; do not edit applied migrations
   (`20260923000001`, `20260927000000`, `20260929000000` all reference effect functions).
4. Delete nothing while the Supabase deployment still serves traffic.

Phases 1–3 deliberately *increase* the value of this phase by shrinking what must be deleted and
by removing the layers that would otherwise obscure the Supabase/native seam.

---

## Sequencing and risk

| Phase | Depends on | Behaviour change | Main risk |
| --- | --- | --- | --- |
| 0 | — | None (documentation) | None. Do it first; it stops further Supabase-parity investment. |
| 1 | 0 | None | Re-pointing 15 test files could silently drop an authorization assertion. Mitigate: diff test counts before/after; keep every `expect`; the Supabase deployment is still live, so this coverage still matters. |
| 2 | 0 | None intended | Moving the portable-retry seam touches the idempotent write path. Mitigate: the C06A/C06B suites are the gate. |
| 3 | 0 | **Yes (reviewed)** | Two capability regressions if ordered wrongly (F5): deleting `app/api/data/` without a v1 backup-restore route, and repointing the client at bearer-only routes. Mitigate: the corrected step order — guards and the restore route land *before* any repoint, and nothing is deleted until step 6. Plus the `revalidatePath` behaviour and 16 components; stage domain-by-domain with action shims. |
| 4 | **C09/C10 + 0** | **Yes (capability drop)** | Mobile queue semantics. Not planned here — its own document. |

Phases 1 and 2 are independent and can run in parallel. Phase 3 is independent of both. Phase 4
is the only one gated, and it is gated on the *existing migration programme's* checkpoints rather
than on an open decision.

---

## Verification

Per `AGENTS.md`, select by impact. Baseline for all phases:

```bash
npm run typecheck && npm run lint
```

```bash
npm run test
```

- `tests/boundary-enforcement.test.ts` — the primary gate for Phases 1, 3 and 4; it already encodes
  the architecture rules being enforced.
- **Phase 1:** full unit suite; specifically `tests/native-repository.test.ts`,
  `tests/supabase-repository-authz.test.ts`, `tests/action-policy.test.ts`,
  `tests/parity-tracer.test.ts`. Coverage gates in `vitest.config.mts` must still pass
  (60% lines/functions/statements, 50% branches; per-file auth gates).
- **Phase 2:** the migration suites with `MIGRATION_TEST_REQUIRE=1` against `TEST_DATABASE_URL`,
  plus `tests/idempotency*.test.ts` and `tests/migration-gate.test.ts`.
- **Phase 3:** the dashboard Playwright flows for each domain as it migrates (the a11y workflow for
  the affected panels), plus the new settings-revalidation test. Exercise `/api/v1` cookie auth
  (`allowCookie` paths) explicitly, since that becomes the browser's main path.
- **Both backend builds must pass** for Phases 1, 2 and 3 — `NEXT_PUBLIC_BACKEND=supabase` and
  `NEXT_PUBLIC_BACKEND=native` — because the Supabase deployment is still live. Only Phase 4 drops
  that requirement.
- Report skipped database/Playwright legs explicitly.

Record the outcome in `docs/ai-context/ARCHITECTURE_DELTA.md` — Phases 1–4 are all
architecture-sensitive (shared interfaces/repository abstractions, API contracts, auth, migrations).

**Refresh the context pack as each phase lands.** The pack currently describes the vestigial
dispatcher as *current* load-bearing architecture, so after Phase 1 it actively misleads the
agents `AGENTS.md` instructs to trust it: `ARCHITECTURE.md` ("the broad `Repository` remains a
compatibility facade"), `MODULE_INDEX.md` (the `Repository contract` / `Native persistence` /
`Supabase persistence` rows still cite `repo`, `nativeRepository`, `supabaseRepository`),
`SYSTEM_MAP.md` (the `Repo[Repository contract]` node), `KNOWN_RISKS.md` (the "Dual-backend
parity drift" row is predicated on the two-implementation `Repository`), and `CONSTRAINTS.md`
(#1 "do not bypass `auth`/`repo`", #2 parity) all go stale the moment Phase 1 removes the
dispatcher. Update them with the phase that invalidates them, not in a later sweep.

---

## Open items

- [x] Adapter-level duplication analysis — **complete** (F3; it is the Phase 4 inventory).
- [x] App-layer survey — **complete** (F4). The load-bearing result is that Actions and v1 already
      share the domain layer, so Phase 3 is transport work, not a logic port.
- [ ] **Genuinely open:** whether `/api/v1` DTOs need any additive field to cover the `/api/data`
      reads being retired (`reports`, `reminders/global`). Confirm during Phase 3 step 1 against
      `lib/api/v1/contracts.ts` before repointing `lib/data/client.ts`.
