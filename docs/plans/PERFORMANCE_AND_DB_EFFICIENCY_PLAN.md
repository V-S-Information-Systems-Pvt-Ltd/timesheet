# Performance & Database Efficiency Plan

Status: unparked implementation complete; D1/D3/D4/P1/P2 and render-pass P3
implemented and verified, D2 migrations applied/verified locally and reported by
the operator as deployed to production; production EXPLAIN/runtime verification
is still outstanding, and P4 is deferred. Author
pass: 2026-10-03; updated 2026-10-04.
**Target branch: `arch/architecture-simplification`** (checkout `C:\dev\timesheet-architecture-simplification`). Paths and line numbers below reference that branch's state, which has already executed Phases 1â€“3 of the architecture work.

## What this plan is â€” and is not

This is the **performance and database-efficiency** companion to the architecture work. It deliberately does **not** re-propose architecture simplification.

> **Architecture simplification is owned by [ARCHITECTURE_SIMPLIFICATION_PLAN.md](ARCHITECTURE_SIMPLIFICATION_PLAN.md)** (implemented on `arch/architecture-simplification`). That plan is deeper, authoritative, and already largely implemented: the vestigial `Repository` dispatcher is removed (Phase 1), the migration tooling is isolated into `migrations/tool/` (Phase 2), and the browser is consolidated onto `/api/v1` with `/api/data` reduced to rollback aliases (Phase 3). It also records the product decision that **`native` is the surviving backend and Supabase retires** (Phase 4, gated). Do not duplicate or contradict it here.

An earlier draft of this plan (in `docs/plan/`) was written against `main`, before that branch's work, and framed everything around the `Repository` contract. That framing is obsolete. This document keeps only the items that are **still real on the surviving architecture** and adds the runtime/query dimension the architecture plan explicitly excludes ("not a line-count exercise â€¦ no latency improvement is claimed without measurement").

## Scope boundary

| In scope (this plan) | Out of scope (see architecture plan) |
| --- | --- |
| Request latency, round-trips, payload size | Backend duality, `Repository` facade, surface consolidation |
| Over-fetching and unbounded responses | `/api/data` â†’ `/api/v1` migration (done) |
| Query shape, indexes, in-DB aggregation | `migrations/tool` isolation / Supabase retirement gates |
| One carried cleanup: de-duplicate `listTimesheets` (correctness + perf) | Everything else structural |

## Guiding constraints (unchanged)

Everything here honors `docs/ai-context/CONSTRAINTS.md`: no bypassing `auth`/domain-port boundaries, no collapsing role axes, additive migrations only, preserve CSRF/origin protection and the RLS-scoped `get_grouped_report_totals`. **Both backends must still build and pass** (`NEXT_PUBLIC_BACKEND=supabase|native`) until the architecture plan's Phase 4 retires Supabase.

---

## Baseline evidence (verified on `arch/architecture-simplification`)

| Observation | Evidence | Status on arch branch |
| --- | --- | --- |
| Dashboard is 100% client-rendered and fires a request waterfall after auth resolves | [app/dashboard/page.tsx:4](../../app/dashboard/page.tsx), fan-out in `fetchProfile` â†’ `Promise.all([...])` at [:232-242](../../app/dashboard/page.tsx) | **Live** |
| Dashboard loads **all** visible timesheets â€” no date, no limit | [app/dashboard/page.tsx:164](../../app/dashboard/page.tsx) `dataClient.getTimesheets()` (no args) â†’ schema `limit` optional, **no max** [packages/contracts/src/timesheets.ts:33-37](../../packages/contracts/src/timesheets.ts) | **Live** â€” scale/abuse cliff |
| `getActor()` is **not** request-memoized | [lib/auth/index.ts:30](../../lib/auth/index.ts); no `cache()` anywhere in `lib/auth/` | **Live** |
| Supabase `getActor` does `select('*')` on `profiles` | [lib/auth/supabase.ts:27-29](../../lib/auth/supabase.ts) | Live **but Supabase-only** â€” native already narrow ([lib/auth/native.ts:43-44](../../lib/auth/native.ts)) |
| `listTimesheets` implemented twice in the surviving native adapter | `list` at [lib/db/native/timesheets.ts:86](../../lib/db/native/timesheets.ts) vs `listTimesheets` at [lib/db/native/reporting.ts:105](../../lib/db/native/reporting.ts) | **Live** |
| Ordering drift between those two copies | `log_date desc, t.id desc` [native/timesheets.ts:131](../../lib/db/native/timesheets.ts) vs `log_date desc, t.created_at desc` [native/reporting.ts:164](../../lib/db/native/reporting.ts) | **Live â€” latent pagination bug** |
| No index backs the admin/all-scope list sort | no `(log_date, created_at)` index in [db/migrations/](../../db/migrations) | **Live** |
| Exact `count(*)` runs by default on every list | [lib/db/native/timesheets.ts:115](../../lib/db/native/timesheets.ts) (`includeCount !== false`) | **Live** |
| Supabase user-filtered report pages all rows and sums in JS | [lib/db/supabase/reporting.ts:50-69](../../lib/db/supabase/reporting.ts) | Live **but on the retiring backend**; native already uses `GROUP BY` [native/reporting.ts:91-99](../../lib/db/native/reporting.ts) |
| `profiles(manager_id)` index for team-scope recursion | **already exists** â€” `profiles_manager_id_idx` [db/migrations/0006_user_hierarchy.sql:18](../../db/migrations/0006_user_hierarchy.sql) | **Done** â€” no action |

---

## Performance initiatives

Effort: S â‰ˆ â‰¤1 day, M â‰ˆ 2â€“4 days, L â‰ˆ 1â€“2 weeks.

### P1 â€” Stop over-fetching the timesheet table *(highest value, architecture-independent)* â€” **IMPLEMENTED**

**Problem.** The dashboard downloads every timesheet the actor can see, with no bound: [page.tsx:164](../../app/dashboard/page.tsx) calls `getTimesheets()` with no args; the query schema sets no default or max `limit` ([timesheets.ts:33-37](../../packages/contracts/src/timesheets.ts)); the native adapter therefore appends no `LIMIT`/`OFFSET`. For an admin/CO this ships the entire table on every mount. It is also an unbounded response for any caller (browser or mobile).

**Correction from the original draft (verified in source).** The first draft assumed the table showed only the current month and proposed date-bounding the fetch. That is **wrong** and would regress the UI:
- `EntriesTable` renders the **full history** grouped by date and paginates **locally** (50/page, sizes 25/50/100) â€” [entries-table.tsx:168-190](../../app/dashboard/entries-table.tsx). Month-bounding would hide older entries, "Edit Last", bulk-select, etc.
- Month hours/count cover the **full calendar month and all actor-visible users** (not just the viewer, not just to today), while `loggedToday` is personal â€” [page.tsx:321-329](../../app/dashboard/page.tsx). So current-month totals cannot come from the table page.
- `ReportExport` and `TelegramPanel` consume the **same complete array** ([page.tsx:413-448,479](../../app/dashboard/page.tsx)); a bounded page would silently truncate CSV export and Telegram commands.
- Select-all selects the **entire filtered history**, not the visible page.
- `limit` alone cannot bound a response: the adapters let inclusive `from`/`to` ranges take precedence ([native/timesheets.ts:133-141](../../lib/db/native/timesheets.ts)).

**Safe staged design (see [BOUNDED_TIMESHEET_READS_DECISION_PACKET.md](BOUNDED_TIMESHEET_READS_DECISION_PACKET.md)).** Bounded **server-side** table paging (fetch only the current page, default â‰¤50 rows per subrequest, preserving sizes/URL state/exact count) *plus* independent month aggregates, *plus* on-demand complete CSV export, *plus* bounded Telegram history. These are activation prerequisites, not optional follow-ups â€” landing the cap alone would silently truncate exports, stats, and history.

**Status.** Implemented on 2026-10-04 with the user's current-page selection
choice and explicit all-filtered-history action. Independent CSV, Telegram,
personal Today, month totals and export-before-deactivation preserve full history
behavior while table/HTTP reads are bounded. Captured bulk edits hold parent
locks through reconciliation; stale sessions/selections cannot replay old work.
Final verification: 1,872 passed / 61 optional skips with coverage gates; lint,
typecheck and both backend builds passed. Disposable native DB: 22 passed;
production browser pagination/auth/report/accessibility: 21 passed. Independent
closure closed all five findings. Offset paging cannot guarantee a transactional
snapshot under count-neutral external changes. [Evidence](../ai-context/P1_BOUNDED_READS_PACKET.md).

### P2 â€” Server-render the dashboard first paint â€” **IMPLEMENTED AND VERIFIED**

**Problem.** The dashboard is `'use client'` end to end ([page.tsx:4](../../app/dashboard/page.tsx)); first paint is JS-download â†’ `onAuthStateChange` â†’ `fetchProfile` â†’ a fan-out of projects/activity-types/timesheets/backfill/(users/superadmin) ([page.tsx:232-242](../../app/dashboard/page.tsx)) plus `getDefaultLayouts`. That is an auth-gated client waterfall (~8 server round-trips, each re-running `getActor`).

**Proposal.** Convert the **initial load** to a Server Component that resolves the actor once and fetches the needed slices in parallel on the server (using the surviving domain ports / `lib/db/*` composition directly â€” not an HTTP hop), passing them as props to a client component that keeps all interactivity (optimistic mutations, tab state, pending-approval polling). Preserve the `classifyAccountView` pending / error / active gates.

**Expected impact.** Move initial data reads into the server render, with content in first paint; measure the resulting browser requests. **Effort.** L. **Risk.** Medium (largest UX-visible change). Sequence after P1, alongside render-pass P3 where it has an actual consumer. **Constraint note.** Server-only reads stay behind the domain ports/`auth`; no secrets to client. **Verify.** `npm run e2e` + `npm run a11y` on dashboard flows including pending-approval and profile-error; confirm optimistic add/edit/delete unaffected.

**Implementation (2026-10-04).** `app/dashboard/page.tsx` is now the Server
Component entry and builds an explicit `DashboardSeed` through
`lib/dashboard-seed-server.ts`. Identity/profile gates run before ancillary
reads; projects, activity types, role-scoped people, backfill/layouts, one
bounded URL-selected entries page and month totals settle independently. The
client hydrates that immutable seed and retains the existing auth subscription,
pending-account polling, retries, optimistic mutations, paging and write locks.
All serialized persistence rows are projected through explicit DTO mappers.

The initial calendar is intentionally unknown on SSR and the first hydration
render. Seeded rows remain in the HTML with literal dates; browser-local
Today/Yesterday labels, edit eligibility, entry-form bounds and leave-month
state activate together from one confirmed browser day. This removes the
server/browser timezone hydration mismatch without assuming a server timezone.

**Verification.** Settled coverage passed (74.19% statements, 66.65% branches,
80.76% functions, 77.45% lines); full lint and typecheck passed; native and
Supabase production builds passed. The deterministic real-browser
calendar-boundary case passed with zero hydration errors and the correct local
date/backfill bounds. The broader native browser matrix passed 25 flows; its
only initial failure was login to a `.env.local` pending-account fixture that
does not exist in the disposable DB. Re-running that pending flow with the
database's seeded inactive fixture passed, covering all 26 selected
dashboard/report/accessibility flows. See
[P2 evidence](../ai-context/P2_SERVER_RENDERING_PACKET.md).

### P3 â€” Memoize `getActor`/`getSessionUser` during server rendering â€” **IMPLEMENTED WITH P2**

**Problem.** `getActor` runs on every guarded action/route and is not memoized ([lib/auth/index.ts:30](../../lib/auth/index.ts)). In Supabase mode it does `auth.getUser()` (a validation round-trip) **plus** a profile read on each call; a mutating action can resolve it in the guard and again in the service.

**Proposal.** Wrap `getActor` and `getSessionUser` in React `cache()` (the primitive already used in `lib/branding-server.ts`) so a single server request resolves identity once.

**Correction / implementation (2026-10-04).** Installed Next guidance defines
this as React render-pass memoization, not general Route Handler request
caching. P2 now provides the actual Server Component consumer:
`lib/auth/render.ts` caches one composite render identity and the cached
self-profile seed reuses it. Route Handlers and browser authentication remain
fresh and unchanged; there is no cross-request auth cache.

**Expected impact.** Deduplicate repeated identity reads during P2's React server render. React `cache()` does not establish Route Handler request caching or deduplicate separate browser requests. **Effort.** S. **Risk.** Low when confined to the render pass. **Verify.** Actual server-render identity reads and auth regression tests on both backends.

Focused render-facade tests prove one actor resolution, session fallback only
when actor resolution is absent, failure propagation, and no persistence across
bare calls. P2's production SSR/browser verification exercises the real
consumer. Exact PostgreSQL statement cardinality was not separately captured;
that remains a measurement limitation rather than a correctness dependency.

### P4 â€” (Low priority) user-filtered reports: aggregate in the DB

**Problem.** Supabase user-filtered reports page through every row and sum in JS ([supabase/reporting.ts:50-69](../../lib/db/supabase/reporting.ts)); native already aggregates with `GROUP BY` ([native/reporting.ts:91-99](../../lib/db/native/reporting.ts)).

**Re-anchored decision.** Because **`native` is the surviving backend and does this correctly**, this is only a defect on the retiring Supabase path. Options: **(a)** do nothing â€” the architecture plan's Phase 4 deletes `lib/db/supabase/*`; **(b)** only if the Supabase support window is long and large user-filtered reports run against it, add an **optional `p_user_id`** to `get_grouped_report_totals` in a new additive Supabase migration (keep `SECURITY INVOKER`, same grants; RLS still scopes rows) and drop the JS loop. **Recommendation: (a) defer** unless measurement during the support window shows real pain. **Constraint note.** Any change here must preserve the RLS-scoped RPC the constraints protect and must not reintroduce the removed unscoped daily-totals RPC.

---

## Database-efficiency initiatives

### D1 â€” De-duplicate `listTimesheets` and fix the ordering drift *(the one carried architecture item)* â€” **IMPLEMENTED**

**Problem.** The surviving native adapter had two near-identical list implementations with **different sort orders**: `list` ordered `log_date desc, t.id desc` ([native/timesheets.ts](../../lib/db/native/timesheets.ts)); the reporting copy ordered `log_date desc, t.created_at desc` ([native/reporting.ts](../../lib/db/native/reporting.ts)). "The same" list paginated differently depending on which path served it.

**Implementing change (this worktree).** The timesheet adapters retain the single scoped list; canonical order is now **`log_date desc, created_at desc, id desc`** in both [native/timesheets.ts](../../lib/db/native/timesheets.ts) and [supabase/timesheets.ts](../../lib/db/supabase/timesheets.ts). The reporting adapters became **factories** that receive the canonical scoped list through a required constructor parameter (`createNativeReportingPersistence(listTimesheets)`, `createSupabaseReportingPersistence(listTimesheets)`), so the duplicated list SQL and its `mapTimesheet` helper are deleted. Wiring happens at the composition roots â€” [lib/db/reporting.ts](../../lib/db/reporting.ts) and the legacy Repository facades ([lib/db/native.ts](lib/db/native.ts), [lib/db/supabase.ts](lib/db/supabase.ts)).

**Why a factory, not a direct import.** `tests/boundary-enforcement.test.ts:293-333` forbids a domain adapter importing a sibling domain adapter (even within one provider). Direct delegation failed that invariant; injecting the list at the composition root satisfies it while still removing the duplicate. Supabase scope is now the adapter's explicit scope (RLS remains the backstop), and the leader/summary path fails closed.

**Status.** Implemented on branch `perf/d1-reporting-dedup` (isolated worktree off `arch/architecture-simplification`). Focused tests in [tests/reporting-list-delegation.test.ts](../../tests/reporting-list-delegation.test.ts) plus scope/ordering assertions in [tests/supabase-repository-authz.test.ts](../../tests/supabase-repository-authz.test.ts) and the canonical-order assertion in [tests/native-repository.test.ts](../../tests/native-repository.test.ts). Full unit suite green (1,779 passed, 60 skipped); typecheck, lint, and `boundary-enforcement` green; native production build green. **Effort.** S. **Risk.** Low (equal-or-more-restrictive than RLS). *Note: the two direct sibling imports were attempted first and rejected by the boundary test â€” final source uses composition injection.*

### D2 â€” Add the index that backs the list sort â€” **DEPLOYED (production verification pending)**

**Problem.** The admin/all-scope list has no `user_id` predicate and no composite index on its sort columns, forcing a sort. No `(log_date, created_at)` index exists in [db/migrations/](../../db/migrations).

**Implementation.** Additive migrations `db/migrations/0038_timesheet_list_sort_index.sql`
and `supabase/migrations/20261006000000_timesheet_list_sort_index.sql` create
`idx_timesheets_logdate_created` on `(log_date desc, created_at desc, id desc)`.
The third key supports D1's stable tie-breaker. Existing scope indexes remain.
Ordinary index creation is compatible with the transactional native runner and
can block writes during deployment; schedule against actual relation size.

**Verification (2026-10-04).** Five focused migration suites: 70 passed, one
PostgreSQL integration check skipped because `TEST_DATABASE_URL` is unset.
The optional check executes the DDL on a temporary table, exercises repeat
execution and tied ordering, and checks index eligibility without claiming
production planner selection. No live schema deployment or latency measurement.

**Later local verification:** a dedicated disposable PostgreSQL 16 database
applied the native schema, including D2. Both index tests passed with its test
connection. A representative joined admin list over 5,000 synthetic entries
used an incremental sort before D2 and the new index without a sort afterward.
The fixture/index comparison was rolled back. This supersedes the earlier local
DB availability limitation; production query-plan/runtime verification remains
open, while deployment is now operator-reported as complete.

**Local-only resume (2026-10-04):** the disposable native database migration
ledger contains `0038_timesheet_list_sort_index.sql` with SHA-256
`eb90344b22953a1a994df3a6760a628ac71875642df199a6c25a16f7cd078885`, matching
the migration file. The canonical runner reported no pending migrations and the
two focused D2 PostgreSQL tests passed. The local Supabase stack then applied its
single pending migration `20261006000000_timesheet_list_sort_index.sql` through
`supabase migration up --local`. No remote/production database was contacted.

**Production deployment update (operator report, 2026-10-04):** the migration
has been pushed to production. This records operator-confirmed deployment only;
this worktree has not independently queried the production migration ledger,
index catalog, planner choice, or latency. Production `EXPLAIN`/runtime evidence
therefore remains pending.

**Impact.** Index-backed global list / pagination. **Effort.** S. **Risk.** Low. **Constraint note.** Additive; ships to `db/migrations/` and `supabase/migrations/`. **Verify.** `EXPLAIN` the admin list before/after.

### D3 â€” Compute month stats as an aggregate, not from shipped rows â€” **IMPLEMENTED**

**Problem.** The dashboard stat cards sum `hours`/`entries` for the current month by filtering the full client-side array â€” which only works because P1's over-fetch shipped everything.

**Proposal.** Serve the month totals from an aggregate query (reuse `getGroupedReportTotals` / a scoped `sum`) so the stat cards do not depend on holding every row in the browser. Pairs with P1 and P2.

**Implementation (2026-10-04).** Month cards use existing scoped report totals
for the full local calendar month, including future dates through month end.
Totals refresh independently on existing mutation callbacks, with explicit
loading/error/retry states. Personal Today and optimistic row operations retain
their prior behavior. Dashboard report reads bypass global singleflight so
remounted dashboards cannot share a previous session's pending report.

Settled D3/D4 verification: 1,829 tests passed, 61 skipped; coverage gates,
full lint, typecheck and both compile-only backend production builds passed.
Independent review closed the remount isolation finding. Database integration
and authenticated browser/a11y flows were not run without an isolated test
backend; benchmarks remain unmeasured. See [D3 packet](../ai-context/D3_MONTH_TOTALS_PACKET.md).

**Impact.** Stat cards stop forcing a full-table client load. **Effort.** S (prerequisite for P1). **Risk.** Low. **Verify.** Stat values match pre-change for seeded data; e2e.

### D4 â€” Make exact counts opt-in â€” **IMPLEMENTED for the dashboard**

**Problem.** `listTimesheets` runs a separate exact `count(*)` over the full scoped set by default ([native/timesheets.ts:115](../../lib/db/native/timesheets.ts)); the dashboard renders no total, so it is a second full scan for nothing.

**Proposal.** Pass `includeCount: false` from callers that don't display a total (dashboard, exports). Keep exact counts only for real paginators; optionally offer a `pg_class.reltuples` estimate for very large admin datasets.

**Implementation (2026-10-04).** The optional strict `includeCount=true|false` query reaches persistence;
omission and true retain existing counts. Native skips the count query and
Supabase omits exact-count options for false. Counted/count-free reads have
distinct single-flight keys. P1's table and Telegram paginators require exact
counts; Today presence and recent shortcuts opt out. Complete-history snapshots
use counts to detect incomplete reads. Streaming report CSV already opts out;
mobile and report paginators retain counts. No approximate-count feature added.

Focused verification: 272 tests across 15 suites passed; lint/typecheck/diff
checks passed. Independent public-contract review found no material issues.
No measured database or HTTP latency claim. See [packet](../ai-context/P3_D4_PERFORMANCE_PACKET.md).

**Impact.** Avoids count queries for reads that do not consume counts. **Effort.** S. **Risk.** Low. **Verify.** Confirm paginator counts remain available; benchmark the list endpoint.

### Not needed (verified already done / present)

- **Narrow `getActor` profile select:** native already selects only `role, permission_role, hierarchy_role, is_active` ([native/native.ts:43-44](../../lib/auth/native.ts)) and the mobile actor is narrow ([mobile-actor.ts:32](../../lib/auth/mobile-actor.ts)). Only Supabase still does `select('*')` ([supabase.ts:29](../../lib/auth/supabase.ts)) â€” a Supabase-only, retiring-path residual; fold into P4's "do nothing / defer" or fix opportunistically.
- **`profiles(manager_id)` index:** already present (`profiles_manager_id_idx`, [0006:18](../../db/migrations/0006_user_hierarchy.sql)). Only verify `team_ids`/cycle-safe variant is `STABLE` so the planner evaluates it once.

---

## Roadmap

| # | Initiative | Effort | Risk | Status | Depends on |
| --- | --- | --- | --- | --- | --- |
| D1 | De-dup `listTimesheets` + canonical order | S | Low | âœ… **Implemented** (this worktree, uncommitted) | â€” |
| D2 | Index for the list sort | S | Low | Locally verified; operator reports production deployment complete; production EXPLAIN/runtime verification pending | D1 (order) |
| P3 | Memoize `getActor` during server rendering | S | Low | Implemented and verified for the P2 React render pass; exact SQL cardinality unmeasured | P2 |
| D4 | Exact counts opt-in | S | Low | Implemented for presence/recent reads; real paginators retain counts | â€” |
| D3 | Month stats as aggregate | S | Low | Implemented | â€” (prerequisite for P1) |
| P1 | Stop over-fetching the timesheet table + bound effective HTTP pages | M | Lowâ€“med | Implemented and verified; page-first selection, explicit all-filtered-history option | â€” |
| P2 | Server-render dashboard first paint | L | Med | Implemented and verified | P1 complete; render-pass P3 alongside |
| P4 | Supabase report in-DB aggregation | â€” | â€” | **Defer** to Supabase-retirement decision | â€” |

Sequence: **D1 âœ“ â†’ D2 deployed* â†’ D4 âœ“ â†’ D3 âœ“ â†’ P1 âœ“ â†’ P2/P3 âœ“**.
The selection decision, export/Telegram separation and server-rendered first
paint are complete. P4 is deferred.
`*` D2 production deployment is operator-reported; production query-plan/runtime
verification remains separate and unmeasured here.

## Success metrics

Capture before/after via `npm run benchmark` / `npm run load`:

- Initial dashboard data requests and transferred timesheet bytes for an admin account (full history â†’ one selected server page); count independent widget/session reads separately.
- Repeated actor/profile reads within the React render pass; HTTP authentication remains fresh per request.
- Admin list query plan (sort â†’ index scan) and p95 latency.
- No regression in `vitest.config.mts` coverage gates; both-backend builds green; e2e + a11y green.

## Verification (maps to existing workflows)

- `npm run typecheck && npm run lint` on every change.
- `npm run test` / `test:coverage` â€” focused success + failure tests per behavior change; honor security-file thresholds.
- **Both backends build** (`NEXT_PUBLIC_BACKEND=supabase` and `native`) â€” required until the architecture plan retires Supabase.
- DB integration tests (`TEST_DATABASE_URL`) for D1/D2/D3; report skips explicitly.
- Keep the migration-parity test green ([tests/supabase-migrations.test.ts](../../tests/supabase-migrations.test.ts)) â€” preserves the RLS-scoped grouping RPC.
- `npm run e2e` + `npm run a11y` for P1/P2/D3 dashboard flows.
- Record outcomes in `docs/ai-context/ARCHITECTURE_DELTA.md`; this plan is a proposal, not an implemented change.

## Reconciliation with the first draft

| First draft (`docs/plan/`, vs `main`) | Fate here | Reason |
| --- | --- | --- |
| "Collapse three HTTP surfaces onto `/api/v1`" | **Dropped** | Done by architecture plan Phase 3 |
| "Converge on one `pg` data layer / point native at Supabase PG" | **Dropped** | Conflicts with decided direction (native survives, Supabase retires entirely) |
| "Repository contract implemented twice" framing | **Dropped** | `Repository` was vestigial and is removed (Phase 1) |
| "Contain migration/idempotency machinery" | **Dropped** | Owned by architecture plan Phases 2 & 4 (now `migrations/tool/`) |
| De-dup `listTimesheets` | **Kept â†’ D1** | Targets surviving native adapter; also fixes an ordering bug |
| getActor memoization | **Kept â†’ P3** | Still unmemoized on arch branch |
| Dashboard over-fetch / SSR | **Kept â†’ P1/P2** | Still live; architecture-independent |
| Ordering/index/count hygiene | **Kept â†’ D2/D4** | Still live |
| Supabase report JS-paging fix | **Demoted â†’ P4 (defer)** | Retiring backend; native already correct |
| Narrow `getActor` select; `manager_id` index | **Removed** | Already done on surviving path |
