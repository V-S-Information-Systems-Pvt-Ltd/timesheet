# Architecture Simplification Plan

> 2026-10-04 migration execution notice: the [four-stage migration plan](SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md)
> now controls Prepare / Dry run / Cutover / Observe for the first Supabase → native transfer.
> Older C00–C10 migration prerequisites/statuses, direction-unknown statements and mandatory
> original-provider rehearsal references below are historical architecture-assessment inputs.
> Current scope and pending evidence follow that plan and its [notes](SUPABASE_NATIVE_MIGRATION_NOTES.md#pending-work).
> Retirement criteria in this architecture assessment remain unchanged.

## Context

VSIS Timesheet is a Next.js 16 App Router timesheet app with two interchangeable
backends (`supabase` default, `native` self-hosted PostgreSQL) plus a React Native
client. The earlier inventory measured ~121k LOC / 585 files; size figures below
are historical estimates, not implementation acceptance criteria.

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
   *source* and retires after cutover and the explicit retirement gates below. (Product decision, user-confirmed 2026-09-23; it was
   open when the second half of this plan was first drafted.)
2. **Client→server consolidates onto `/api/v1`** — the browser's remaining three surfaces
   retire in its favour. Aggressive consolidation is authorized.

**The governing principle that follows from decision 1:** avoid discretionary expansion of
Supabase-specific capability and make eventual retirement straightforward. Continue security
fixes, correctness fixes, required schema changes and regression/parity coverage while Supabase
serves traffic or remains a supported recovery target. Runtime compatibility state, recovery
tools and the source database have different retirement conditions; C10 alone deletes none of
them automatically. Applied native migration history remains part of the surviving system.

It is explicitly **not** a line-count exercise. `docs/plans/archive/OVERENGINEERING_REMEDIATION_PLAN.md`
(2026-09-19) already correctly rejected a previous LOC-driven proposal, and its standard of
evidence is adopted here. Note that its central caveat — *"if retiring Supabase replay becomes
a product requirement, first record current capability settings and migration state for every
deployment, specify mobile queue behavior, then use additive migrations and a staged
rollout"* — is **now triggered**, and Phase 4 is written to satisfy it.

### Decisions taken into this plan

| Question | Answer | Consequence |
| --- | --- | --- |
| Is dual-backend permanent? | **No — transitional; `native` survives** | Retirement follows C09/C10 and the separate compatibility, recovery and source-retirement gates in Phase 4. |
| Migration tooling? | **Keep, but isolate — and define retirement criteria** | Separate operator tooling from runtime compatibility code, give it an explicit verification owner, and retain usable recovery capability for its agreed lifetime. |
| Behaviour-change appetite? | **Aggressive consolidation allowed** | Retiring three client→server surfaces and a coordinated `/api/v1` change are in scope. |
| Mobile production rollout? | **Not in production, per the operator** | A coordinated production mobile release is conditional on actual deployed consumers. Inventory test/development clients and issued retry keys as well. |

---

## Evidence

The quantitative inventory was recorded against `e4be0d2` on 2026-09-26; the first draft was
measured at `675abe8`. Contract and lifecycle corrections below were verified against `7f34dd7`
on `arch/dual-backend-modular-implementation` (PR #8), including an Astra High review of retry
and recovery retirement. This revision does not claim a new LOC census or a completed
implementation/rehearsal. Source symbols take precedence over historical line offsets.

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

The recorded growth supports defining ownership and retirement criteria. Between the two measurements
the repository added 4,384 lines, essentially all of it migration work (`migration-fence.test.ts`
+496, `migration-provider-fence.int.test.ts` +414, two new `supabase/migrations/`, plus mobile
offline-queue changes). Required correctness work remains necessary while these capabilities are
supported; line growth alone is not evidence that it can be removed.

It is an **operator CLI**, reached only through `scripts/migrate-backend.ts` (`npm run migration`).
`tests/boundary-enforcement.test.ts:369,391` already enforces that application code cannot import
it and that it cannot import request-bound modules. Architecturally it is already a separate tool
— it is just filed inside `lib/`, so it inherits the app's coverage gates, lint config, tsconfig
and CI wiring.

Runtime compatibility responsibilities remain separate from the operator CLI:

1. **`lib/idempotency.ts` (1,424 lines, was 1,393).** Roughly **590 lines** are migration-era logic
   (`PortableRetryRow`, `readPortableRetryRows`, `decidePortablePayload`, `applyPortableTranslation`,
   `classifyPortablePayload`, `remapPortablePayload`, `resolvePortableRetry`, `readLegacyStampedLedger`,
   …; 59 occurrences of "portable"). Keyed requests handled by `withIdempotency` can read
   `migration_retry_history` and `migration_record_map` before ordinary idempotency processing.
   This does not apply to every v1 mutation: `withIdempotency` immediately executes requests
   without an idempotency key. No latency improvement is claimed without measurement.
2. **`lib/db/write-gate.ts` (138 lines).** Reads `public.migration_write_gate` on every write path
   guarded by it in both backends. The gate also supplies the generation used by
   `lib/idempotency-fresh-key.ts`: ticket issuance, admission and cleanup depend on
   `migration_write_gate` / `migration_fresh_keys`, with a 97-day ticket lifetime. The gate
   cannot be removed solely because the cutover has completed.

These are required runtime behaviors while imported retries or issued tickets are supported.
Isolation should clarify their ownership and preserve execution/refusal behavior. It does not
make the state disposable or justify a default bypass.

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

**This is a Phase 4 candidate inventory, subject to its retirement gates.**

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

**The useful shared boundary:** Server Actions and `/api/v1` services *already sit on the same
domain layer* — both import `@/lib/db/*` composition and `@/lib/domain/*` directly, and **no
action imports a v1 service or vice versa**. This reduces domain work, but does not establish
equivalence of authentication, authorization, DTOs, filters, write budgets, error handling or
cache refresh. Phase 3 must verify those contracts before replacing each transport.

Supporting detail:

- `lib/data/client.ts` already routes **timesheets** through `/api/v1` (line 209) but the other
  ~17 reads/writes still target `/api/data/*` (projects, profiles, profile, backfill-window,
  activity-types, leaves ×3, reminders ×4, global-reminders ×2, reports).
- Similar endpoint names do not establish equivalent contracts. The proposed backfill mapping
  changes access from any active user to admin-only, and `/api/v1/auth/me` returns a different
  DTO from `/api/data/profile`. Browser authentication and some superadmin capabilities also
  need new transports (F5).
- 16 dashboard components import actions via the **relative** path `'../actions'`
  (`app/dashboard/*.tsx`). They do **not** use `useActionState`, `useFormState`, or the
  `action={…}` form prop — every call is imperative. Replacing the invocation is straightforward
  only after its transport contract and visible refresh behavior are covered.
- Six raw `fetch` calls bypass `lib/data/client.ts`: `app/reports/page.tsx:289,298,307,317,338`
  and `app/dashboard/backup-panel.tsx:51`.
- `revalidatePath('/', 'layout')` appears **twice**, both in `app/actions/settings.ts`
  (lines 226, 237). Preserving immediate UI refresh requires more than copying this call into
  a Route Handler (F5).
- The `restoreBackup` **Server Action** is dead (`app/actions/import-backup.ts:183-205`, facade
  `app/actions.ts:137`). The former `app/api/data/timesheets/route.ts` dead candidate has now been
  retired after the k6 caller moved to v1 and the versioned route gained explicit full-filter
  regression coverage. Other units require caller/contract evidence (F5).

### F5 — Browser contract gaps that must precede transport deletion

Cookie support currently covers five timesheet route files:
`timesheets{,/[id],/[id]/duplicate,/batch-delete,/batch-duplicate}`. The protected v1 guard
takes the bearer branch when an Authorization header is present; cookies require an explicit
`allowCookie` opt-in. Its existing unsafe-cookie path applies `originCheck`, which should be
reused and tested. That opt-in does not supply browser login, logout or password recovery.

The following is a verified seed inventory, not a complete operation-by-operation matrix:

| Existing capability | Verified gap in the proposed replacement | Required plan treatment |
| --- | --- | --- |
| Browser login/logout | `app/api/auth/login` creates a cookie; v1 login returns mobile tokens. V1 logout revokes a mobile session rather than clearing the browser cookie. | Define explicit browser session transports under v1 and preserve both credential lifecycles. |
| Password recovery and registration | V1 lacks equivalents for `forgot-password`, `reset-password`, `domain-check` and the browser's `revoke-mobile-sessions` flow. | Cover every `lib/auth/client.ts` operation, confirmation/recovery state and password-change revocation before removing `/api/auth`. |
| Backfill settings read | `getBackfillSettings` allows active users; `getAdminBackfillSettings` rejects non-admins (`lib/domain/workspace.ts:81-103`). | Add an active-user v1 read; preserve admin-only writes and administrative access checks. |
| Self/team profiles | `mapActorDto` uses `isActive`, `permissionRole`, `hierarchyRole`, `managerId`; the dashboard consumes snake_case `User` fields (`app/dashboard/page.tsx:171-195`). | Explicitly map DTOs to the existing browser contract or migrate all consumers in the same slice. |
| Superadmin operations | Live whitelist-management and database-reset actions in `app/actions/superadmin.ts` have no v1 replacements. | Inventory every live action, add the missing routes, and preserve superadmin/resource checks. |
| Backup restore | `app/dashboard/backup-panel.tsx` calls the live `/api/data/backup/restore` route; the dead restore action is a different transport. | Add `/api/v1/admin/backup/restore` before removing the compatibility route. |
| Reference/filter variants | `/api/v1/reference` combines projects, activity types and titles, but the browser also requests variants such as `activity-types?all=1`. | Preserve active/all visibility and permissions; coalesce compatible reads only. |
| Branding refresh | The installed Next.js guide distinguishes immediate Server Function UI updates from Route Handler invalidation on the next visit. | Preserve server invalidation and add explicit client refresh where needed; verify the visible result. |

Evidence: `lib/auth/client.ts`, `app/api/auth/`, `app/api/v1/auth/`,
`lib/api/v1/contracts.ts:31-45`, `lib/api/v1/services/reference.ts:12-27`,
`app/actions/superadmin.ts`, `app/api/data/activity-types/route.ts`, and
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`.

The completed matrix must also cover report/export filters, global-reminder visibility,
batch semantics, status/envelope mapping, rate limits and retry behavior. Shared domain calls
do not settle these differences; for example, the compatibility leave route supplies an
unthrottled write budget while the v1 service uses the default domain budget.

---

## Plan

Five phases. Phase 0 records direction and support obligations. Phase 1 removes the facade;
Phase 2 isolates tooling and runtime compatibility without changing behavior; Phase 3 replaces
browser transports only after their contracts are covered. Phase 4 follows C09/C10 and its
separate retirement gates, with its own execution document. Updating this plan does not mark
any implementation checkpoint complete or resume the deferred C08 rehearsal.

### Phase 0 — Record the direction and remaining support obligations

The migration ledger still lists **"first production direction" as an unanswered C00 item**.
Record the stated native-survives decision directly; a reserved recovery database does not
establish migration direction. `C08_REHEARSAL_RUNBOOK.md:5,81` requires recovery into the
**original provider**: Supabase for Supabase→native, native for native→Supabase. The reserved
local native recovery database therefore does not satisfy Supabase→native recovery.

1. Record Supabase→native as the first production direction in the C00 ledger and resolve only
   that decision item. Other inventory, fencing, capacity and recovery-target blockers remain;
   production cutover still requires the existing C09 authorization.
2. Add an ADR under the `docs/ai-context/ADR_INDEX.md` convention recording *"dual-backend is
   transitional; native is the survivor; Supabase is a migration source that retires"* — because
   contributors need a durable record of the intended destination and support period.
3. Avoid discretionary Supabase expansion. Continue required security/correctness fixes,
   additive schema changes and regression/parity tests while Supabase is live or a supported
   recovery target; do not waive those checks for simplification work.
4. Record the operator's statement that mobile is not in production. Inventory actual
   deployments, test clients, pending requests and issued tickets before deciding whether a
   coordinated mobile release or a compatibility window is required.

### Phase 1 — Retire the vestigial `Repository` dispatcher

Removes approximately 1,050 facade lines. Both backends keep working throughout their support
period; only the *facade layer* goes.

**Status (2026-09-26): implemented on `arch/architecture-simplification`; verification evidence is recorded in the handoff and architecture delta.**

1. **Split `lib/db/repository.ts` → `lib/db/types.ts`.** Keep everything at lines 36–236
   (`Actor`, `DbWrite`, `DbResult`, `DbCreateResult`, `TimesheetInput`, `TimesheetListOptions`,
   `BulkTimesheetUpdate`, `ReportBucket`, `requireActive`, `requireRole`, …) — imported by ~25
   files and must keep working. Drop the `Repository` interface (lines 242–472). Re-export from
   the old path for one commit so the change is reviewable, then remove the shim.
2. **Resolve the one non-delegating method by its callers.** `findWhitelistedDomain` contains
   SQL in the facades, but registration already uses its own `RegistrationPort` implementations
   in `lib/auth/registration-{native,supabase}.ts`. Confirm references before deleting the unused
   facade method; do not add a second reference-domain method solely to preserve dead code. If
   a live caller is discovered, move it to the appropriate existing boundary and retain coverage.
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

Preserve migration and retry capability throughout extraction. Operator tooling and runtime
compatibility code have separate boundaries and may have different retirement dates.

**Implementation status (2026-09-26): complete in the working tree.** Operator source and tests
now live in the private `@vsis/migration-tool` workspace under `tools/migration/`; the root CLI is
unchanged, package lint/type/unit/integration/coverage checks have a dedicated CI job, and runtime
portable retry orchestration lives in `lib/idempotency/portable-retry.ts`. Application imports of
the operator package are rejected by the boundary suite. R1–R3 remain future retirement gates:
this extraction removes no runtime reader, provenance state, applied migration, or recovery tool.

1. **Move `lib/migration/` → `tools/migration/`** as its own workspace package (add `tools/*` to
   the root workspace, or place it at `packages/migration`). Move `scripts/migrate-backend.ts`
   with it and keep `npm run migration` working unchanged. Update the two boundary rules
   (`tests/boundary-enforcement.test.ts:369,391`) to the new path — they already encode exactly
   the right constraint.
2. **Extract runtime retry compatibility by behavior, not line ranges.** A cohesive module such
   as `lib/idempotency/portable-retry.ts` must own imported-history resolution, local-history
   precedence, namespace/conflict/uncertain refusals, authorization, payload classification and
   translation before execution/fingerprinting, and fresh-key admission. `withIdempotency`
   currently calls several of these separately; moving only `resolvePortableRetry` is incomplete.
   Keep effect/legacy-ledger helpers available to `runSupabaseStampedDelivery` where they are
   shared. Keep runtime code outside the operator package and preserve the application import
   boundary. Wire the existing behavior explicitly: **no no-op default, missing-configuration
   bypass or database-error fallback**. Preserve unkeyed behavior and ordinary native idempotency.
   Acceptance covers activation/fencing, successful completion, recovery, retries, stale keys
   and concurrent generation changes together; all existing refusal and replay outcomes remain.
3. **Give the migration suites their own CI job.** Their required integration legs use
   `MIGRATION_TEST_REQUIRE`; today migration checks run inside the app's `lint-test` and `e2e`
   jobs and implementation files sit inside the `lib/**` coverage scope (`vitest.config.mts:31`).
   Excluding `tools/migration/**` from the app coverage scope
   makes the app's coverage scope clearer only if the new package retains explicit lint, type,
   unit/integration and coverage gates. Runtime retry compatibility stays in application coverage.
   The path move must not silently skip suites or remove required branch checks.
4. **Record separate retirement gates** using Phase 4's R1–R3. C10 completion is a prerequisite,
   not a deletion trigger. Inventory gate readers, ticket issuance/admission/cleanup, imported
   history, mappings/provenance and recovery dependencies. Remove runtime readers only after
   their supported-request contract is satisfied; remove operator tools only after the recovery
   obligation is preserved or explicitly replaced. Retain applied native migration files and
   plan additive teardown migrations after compatible application rollout.

### Phase 3 — Consolidate the client→server paths onto `/api/v1`

**Implementation status (2026-09-26): complete in the working tree.** All production browser
data/authentication callers, dashboard Server Action consumers and raw application fetches now
use versioned resources through `lib/auth/client.ts` or `lib/data/client.ts`. Contract-specific
cookie/bearer branches preserve the released mobile shapes, and boundary coverage prevents browser
code from returning to Server Actions, `/api/data/*`, or `/api/auth/*`. Neutral origin-checking and
direct auth-facade use also prevent v1/shared browser endpoints from depending on those legacy
modules. The old server routes and action facade remain callable only as rollout rollback aliases:
source caller-zero is proven, but deployed-consumer inventory/observation is still required before
their destructive removal. Closure evidence: 1,601 application tests and aggregate coverage gates,
lint, TypeScript, and both backend production builds passed; 60 environment-gated tests were skipped.

Target: **four application transport surfaces → one versioned surface**, with shared guard
primitives and explicit cookie/bearer session handling. Shared domain functions reduce the work;
they do not prove transport equivalence. Each domain slice must be independently shippable.

Completed implementation and acceptance ownership are tracked in
`docs/ai-context/PHASE3_TRANSPORT_CONTRACT_MATRIX.md`. Legacy aliases remain available as rollback
paths except the zero-caller legacy timesheet read, which was retired after its k6 caller moved to
v1 and full-filter regression coverage was added to the versioned route.

1. **Complete the contract matrix before repointing any caller.** Start with F5 and enumerate
   every live action, `/api/data` and `/api/auth` operation, including raw fetches and
   `lib/auth/client.ts`. Record caller, method/path, signed-in/active/role/resource checks,
   cookie or bearer credentials, request/response fields, filters/pagination, batch semantics,
   error/status mapping, rate limits, idempotency/retry behavior and UI invalidation. Assign a
   replacement and an acceptance check to every row. Record intentional behavior changes
   explicitly. A similar URL or shared domain function does not close a row. The working
   inventory and acceptance assignments are recorded in
   `docs/ai-context/PHASE3_TRANSPORT_CONTRACT_MATRIX.md`.
2. **Share guard primitives and extend cookie admission.** Consolidate `originCheck`,
   `SAFE_METHODS`, response helpers and write-fence refusal without collapsing the distinct
   cookie and bearer session lifecycles. Preserve signed-in versus active-account checks,
   role/resource checks and the rule that an invalid explicit bearer cannot fall back to a
   cookie. Opt in only the browser routes identified by the matrix, including required admin
   routes; keep their authorization policies. Cover accepted cookies, foreign-origin writes,
   revoked/inactive sessions, invalid bearers and mobile capability configuration before use.
3. **Implement browser authentication under `/api/v1/auth/`.** Define explicit browser
   variants where token-returning mobile endpoints cannot preserve the contract. Cover cookie
   creation, renewal after password change and logout clearing, session/profile reads,
   registration/domain checks, confirmation, forgot/reset-password and Supabase recovery state.
   Preserve the begin/complete mobile-session revocation flow around provider password changes.
   Browser availability must not depend accidentally on the mobile bearer feature flag. Update
   `lib/auth/client.ts` only after both backends' browser flows and the existing bearer flows pass.
4. **Add missing application routes before migrating their callers.** Add
   `/api/v1/admin/backup/restore` with the current admin and restore semantics. Add a separate
   active-user backfill read (proposed `/api/v1/settings/backfill`); retain the admin settings
   route and admin-only writes. Supply whitelist management, database reset and every other
   missing live action found by the matrix, preserving superadmin and resource protections.
5. **Implement explicit DTO adapters and repoint the data client by domain.** Keep the existing
   browser `DataClient` contract through explicit mappings, or update all affected consumers in
   the same slice. Do not cast the v1 `MobileActorDto` to `User`: map `isActive`, `permissionRole`,
   `hierarchyRole`, `managerId` and verify all other required fields. Apply the same check to
   people, projects, activity types, leaves, reminders, global reminders and reports. Preserve
   active/all and visibility/filter variants. Use the new active-user backfill route. Coalesce
   compatible projects/activity-type reads through `/api/v1/reference` with shared in-flight
   retrieval; changing both URLs alone does not guarantee one round-trip.
6. **Migrate raw fetches and action consumers in bounded slices.** Move the five report exports
   and backup-panel fetch into the shared client. Move dashboard action callers domain by
   domain: timesheets, projects, users, settings, superadmin and import-backup. Preserve batch,
   budget, retry and error behavior or record the deliberate change in the matrix. Keep old
   transports available until their slice's callers and verification have moved; retain a
   callable rollback path while rolling out the replacements.
7. **Preserve the visible branding refresh.** Add the existing server-side
   `revalidatePath('/', 'layout')` invalidation to replacement branding routes and explicit
   client refresh, such as `router.refresh()`, where needed. The installed Next.js guide says
   Route Handlers invalidate for a subsequent visit, whereas Server Functions can update the
   current UI. Verify branding changes on the already-open page and subsequent navigation;
   checking only that `revalidatePath` was invoked is insufficient.
8. **Delete old transports only when their matrix rows are complete.** Require zero live
   callers, passing browser/role/contract checks, and preserved capabilities before removing
   `/api/data/`, `/api/auth/` and the action facade/implementations. Include auth and raw fetch
   callers in the search. Remove confirmed dead units with their applicable checks. Then tighten
   boundary rules against reintroducing the retired surfaces.

**Compatibility:** these are browser-visible HTTP and session changes, not merely internal
refactoring. Preserve existing v1 contracts; prefer additive changes where sufficient. Mobile
is not in production, so a coordinated production mobile release is required only if inventory
finds deployed consumers whose supported contract changes. Development/test clients still need
matching builds and queue behavior; do not silently reinterpret existing queued requests.

### Phase 4 — Retire Supabase through separate acceptance gates

**Prerequisites:** record Phase 0's direction, complete C09/C10 and the relevant replacement
slices, and prepare `docs/plans/SUPABASE_RETIREMENT_PLAN.md` with deployment-specific evidence.
C10's PASS explicitly permits source retention as a separate decision and continues to name
reverse migration as recovery (`SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md:450-464`).
It therefore does not automatically satisfy any of the retirement gates below.

| Gate | Required evidence | What it permits |
| --- | --- | --- |
| R1 — Runtime retry compatibility | Inventory imported histories, mappings, supported clients/requests, issued tickets and deployed capability settings. Define how old requests are resolved or explicitly rejected before compatibility state is removed. | Retire compatibility readers and state only after supported behavior no longer depends on them. |
| R2 — Recovery tools and provenance | Explicitly replace the reverse-migration commitment with an accepted, tested recovery approach meeting the agreed RTO/RPO, or retain a versioned usable recovery tool and its required records/dependencies. | Remove only tooling and provenance no longer required by the documented recovery/retention obligation. |
| R3 — Provider/source retirement | Verify no serving traffic or remaining supported provider consumers, complete observation and retention obligations, and obtain the existing separate authorization before irreversible source deletion. | Retire the provider deployment and its unused runtime/build surface. Source destruction remains a distinct recorded action. |

**R1 must include the complete ticket lifecycle.** `lib/idempotency-fresh-key.ts` issues 97-day
tickets; issuance and admission depend on the current gate generation, and cleanup still runs
from `lib/idempotency.ts`. Include `/api/v1/idempotency-tickets`, issuance, outstanding tickets,
admission and cleanup in the change. Either demonstrate no supported consumers/outstanding
tickets, or stop issuance and preserve outstanding-key behavior through the supported window.
Waiting 97 days alone is insufficient: imported history and mapping reads have no automatic
time-based retirement cutoff. Committed native keys must still replay after ticket expiry or a
generation change; preserve claims, conflicts and uncertain-commit behavior. Rehearse stale
requests, concurrent requests and deployment rollback before retiring the readers.

**R2 must preserve recovery of the full current authority.** Export uses mappings joined to
migration runs to preserve provenance (`lib/migration/export.ts:640-662`). Removing those
records can invalidate the promised reverse path even after import succeeds. A retained source
snapshot is not a recovery copy of later native writes. Document the replacement or retained
recovery artifact and verify it before removing its dependencies. The deferred C08 rehearsal
does not constitute that evidence.

Record `DURABLE_IDEMPOTENCY_ENABLED`, `NEXT_PUBLIC_BACKEND`, schema/migration state and actual
client use **for every deployment**. The operator reports mobile is not in production; do not
make a coordinated production mobile release mandatory without deployed consumers. Retain a
documented queue policy for any existing test/development clients and arrange matching client
changes where needed. Reassess if mobile enters production before retirement.

The candidate inventory must be resolved against the applicable gates, not deleted in bulk:

| Target | Retirement treatment |
| --- | --- |
| `lib/db/supabase/*`, `lib/supabase/*`, Supabase auth implementations | R3; preserve any dependency still required by retained recovery tooling under R2. |
| `lib/db/supabase.ts` | Removed in Phase 1 after its callers move. |
| Supabase effect path / `runSupabaseStampedDelivery`, `DURABLE_IDEMPOTENCY_ENABLED` | R1/R3; preserve surviving native idempotency and shared helper dependencies. |
| Runtime compatibility module, `lib/idempotency-fresh-key.ts`, ticket route and write-gate callers | R1 plus the end of required fencing/recovery use under R2/R3. |
| `migration_*` tables | Identify each table's readers, history/provenance and retention duties; remove only through additive teardown after the applicable gates. |
| `tools/migration/` | R2; retain a usable version and required evidence if reverse recovery remains supported. |
| Applied `db/migrations/` files | **Keep.** They are the surviving native installation/upgrade history. |
| `supabase/migrations/` | Archive/remove the retired provider tree only as a separate R2/R3 decision; never rewrite applied files to implement teardown. |
| Supabase tests and the second build/e2e leg | Retire alongside the capabilities they verify; preserve verification for supported recovery artifacts. |

**Database rollout order:** first deploy compatible application code and settle supported
requests/recovery obligations, then add ordered teardown migrations. Check all remaining SQL
functions, triggers, constraints and readers before dropping a table. Do not edit/delete
applied native migrations: for example, `0036_migration_write_gate_generation.sql` alters a
table created by `0033_migration_write_gate.sql`. Retain necessary applied Supabase migrations
while that provider is supported, including effect-function dependencies. Verify upgrades and
clean native installs and specify recovery for the irreversible teardown step. Ordinary native
`idempotency_keys` and its durable replay guarantees survive this phase.

---

## Sequencing and risk

| Phase | Depends on | Behaviour change | Main risk |
| --- | --- | --- | --- |
| 0 | — | None (documentation) | Confusing destination choice with recovery-target selection, or ending maintenance before the live deployment retires. |
| 1 | 0 | None intended | Preserve the authorization scenarios/assertions when repointing tests; test counts alone do not prove equivalent coverage. |
| 2 | 0 | None intended | Preserve the full retry/refusal protocol and package verification while moving code; no default bypass. |
| 3 | 0; contract matrix before each replacement | Transport changes; preserve existing behavior unless explicitly recorded | Browser sessions, role checks, DTO/filter gaps, missing operations and current-page refresh; verify each slice before retiring callers/routes. |
| 4 | 0, C09/C10, relevant replacements and R1–R3 | Explicit capability retirement | Premature loss of retry history, fresh-key admission, recovery capability or install/upgrade history. |

Start with Phase 1's facade cleanup. Phase 2's isolated work and Phase 3's contract inventory
can proceed independently with bounded ownership. Their runtime edits overlap in guards and
idempotency behavior, so coordinate those changes and verify the combined result. Phase 3's
browser data, browser-auth/recovery, individual/bulk-edit timesheet and project/user-administration callers now use
versioned transports with legacy auth routes retained as shared-handler rollback aliases;
complete the remaining administrative and Server Action rows
before retiring legacy transports. Phase 4 remains blocked until its applicable acceptance gates
have evidence; C08 stays deferred at the operator's request.

---

## Verification

Per `AGENTS.md`, select by impact. Documentation-only plan/ADR changes require content, path
and diff checks. The following checks apply when implementing the corresponding code changes:

```bash
npm run typecheck && npm run lint
```

```bash
npm run test
```

- `tests/boundary-enforcement.test.ts` verifies import/route boundaries for Phases 1, 3 and 4;
  it does not replace behavioral acceptance checks.
- **Phase 1:** full unit suite; specifically `tests/native-repository.test.ts`,
  `tests/supabase-repository-authz.test.ts`, `tests/action-policy.test.ts`,
  `tests/parity-tracer.test.ts`. Coverage gates in `vitest.config.mts` must still pass
  (60% lines/functions/statements, 50% branches; per-file auth gates).
- **Phase 2:** the migration suites with `MIGRATION_TEST_REQUIRE=1` against `TEST_DATABASE_URL`,
  plus `tests/idempotency*.test.ts`, `tests/migration-portable-classification.test.ts`,
  `tests/migration-retry-history.test.ts` and `tests/migration-gate.test.ts`. Cover imported versus
  local history, ambiguity, uncertain commits, reauthorization, translation before fingerprinting,
  fresh/expired/stale-generation tickets, database errors and concurrent fencing. Verify that the
  package move still discovers every required suite and enforces its own coverage/type/lint gates.
- **Phase 3:** require acceptance evidence for every contract-matrix row. Cover both backends'
  browser login/logout, registration/confirmation, password change/reset and session revocation;
  signed-in inactive versus active actors; foreign-origin cookie writes; invalid bearer plus
  valid cookie; mobile feature-flag independence; and existing bearer behavior. Exercise the
  backfill read as an ordinary user and reject unauthorized writes. Verify profile/people DTO
  mapping, active/all and report/global-reminder filters, superadmin operations, restore, batch
  outcomes, budgets and retry/error handling. Run dashboard Playwright and affected accessibility
  flows per slice. Check immediate branding changes on the open page and later navigation.
- **Phase 4:** record evidence for R1–R3 separately. Validate outstanding/expired tickets and
  committed replay, old-request rejection/resolution, retained/replacement recovery, application
  rollback limits, and native clean-install/upgrade paths after additive teardown. Do not delete
  verification merely to make a retired-code check pass; preserve coverage for surviving behavior.
- **Both backend builds must pass** for Phases 1, 2 and 3 — `NEXT_PUBLIC_BACKEND=supabase` and
  `NEXT_PUBLIC_BACKEND=native` — because the Supabase deployment is still live. Only Phase 4 drops
  that requirement.
- Report skipped database/Playwright legs explicitly.

Record implemented outcomes in `docs/ai-context/ARCHITECTURE_DELTA.md` — Phases 1–4 are all
architecture-sensitive (shared interfaces/repository abstractions, API contracts, auth, migrations).
Do not describe this plan revision as a deployed or implemented architecture change.

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

- [x] Shared-domain and facade analysis recorded; rate limiting is the remaining dispatcher consumer.
- [x] Browser contract gaps and lifecycle review incorporated into this plan; implementation is pending.
- [x] Record direction and support obligations in the ADR/C00 ledger without closing other blockers.
- [x] Complete the operation-by-operation browser/auth/action contract matrix and acceptance checks.
- [x] Define browser v1 session/recovery transports and map all DTO/filter/permission differences.
- [x] Supply active-user backfill, superadmin, restore and other missing v1 capabilities.
- [x] Verify behavior-preserving extraction and retain independent operator-package checks.
- [x] Add a read-only, digest-bound Phase 4 deployment evidence inventory command and retirement-plan template; no live deployment inventory or retirement decision is claimed.
- [ ] Inventory every deployment's capabilities, supported clients, imported histories and issued keys.
- [ ] Define the old-request/ticket retirement contract, including late retries and local committed replay (R1).
- [ ] Preserve or explicitly replace and verify reverse recovery before retiring its tools/provenance (R2).
- [ ] Complete C09/C10 and separately record provider/source-retirement evidence and authorization (R3).
- [ ] Plan additive teardown and prove native clean-install/upgrade compatibility; retain applied native history.
- [ ] Resume the deferred C08 rehearsal only when the operator directs it; no rehearsal or cutover is authorized by this plan edit.
