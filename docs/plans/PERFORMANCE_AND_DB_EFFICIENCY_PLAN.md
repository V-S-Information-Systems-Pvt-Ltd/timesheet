# Performance & Database Efficiency Plan

Status: proposal (not started). Author pass: 2026-10-03.
**Target branch: `arch/architecture-simplification`** (checkout `C:\dev\timesheet-architecture-simplification`). Paths and line numbers below reference that branch's state, which has already executed Phases 1–3 of the architecture work.

## What this plan is — and is not

This is the **performance and database-efficiency** companion to the architecture work. It deliberately does **not** re-propose architecture simplification.

> **Architecture simplification is owned by [ARCHITECTURE_SIMPLIFICATION_PLAN.md](ARCHITECTURE_SIMPLIFICATION_PLAN.md)** (implemented on `arch/architecture-simplification`). That plan is deeper, authoritative, and already largely implemented: the vestigial `Repository` dispatcher is removed (Phase 1), the migration tooling is isolated into `tools/migration/` (Phase 2), and the browser is consolidated onto `/api/v1` with `/api/data` reduced to rollback aliases (Phase 3). It also records the product decision that **`native` is the surviving backend and Supabase retires** (Phase 4, gated). Do not duplicate or contradict it here.

An earlier draft of this plan (in `docs/plan/`) was written against `main`, before that branch's work, and framed everything around the `Repository` contract. That framing is obsolete. This document keeps only the items that are **still real on the surviving architecture** and adds the runtime/query dimension the architecture plan explicitly excludes ("not a line-count exercise … no latency improvement is claimed without measurement").

## Scope boundary

| In scope (this plan) | Out of scope (see architecture plan) |
| --- | --- |
| Request latency, round-trips, payload size | Backend duality, `Repository` facade, surface consolidation |
| Over-fetching and unbounded responses | `/api/data` → `/api/v1` migration (done) |
| Query shape, indexes, in-DB aggregation | `tools/migration` isolation / Supabase retirement gates |
| One carried cleanup: de-duplicate `listTimesheets` (correctness + perf) | Everything else structural |

## Guiding constraints (unchanged)

Everything here honors `docs/ai-context/CONSTRAINTS.md`: no bypassing `auth`/domain-port boundaries, no collapsing role axes, additive migrations only, preserve CSRF/origin protection and the RLS-scoped `get_grouped_report_totals`. **Both backends must still build and pass** (`NEXT_PUBLIC_BACKEND=supabase|native`) until the architecture plan's Phase 4 retires Supabase.

---

## Baseline evidence (verified on `arch/architecture-simplification`)

| Observation | Evidence | Status on arch branch |
| --- | --- | --- |
| Dashboard is 100% client-rendered and fires a request waterfall after auth resolves | [app/dashboard/page.tsx:4](app/dashboard/page.tsx), fan-out in `fetchProfile` → `Promise.all([...])` at [:232-242](app/dashboard/page.tsx) | **Live** |
| Dashboard loads **all** visible timesheets — no date, no limit | [app/dashboard/page.tsx:164](app/dashboard/page.tsx) `dataClient.getTimesheets()` (no args) → schema `limit` optional, **no max** [packages/contracts/src/timesheets.ts:33-37](packages/contracts/src/timesheets.ts) | **Live** — scale/abuse cliff |
| `getActor()` is **not** request-memoized | [lib/auth/index.ts:30](lib/auth/index.ts); no `cache()` anywhere in `lib/auth/` | **Live** |
| Supabase `getActor` does `select('*')` on `profiles` | [lib/auth/supabase.ts:27-29](lib/auth/supabase.ts) | Live **but Supabase-only** — native already narrow ([lib/auth/native.ts:43-44](lib/auth/native.ts)) |
| `listTimesheets` implemented twice in the surviving native adapter | `list` at [lib/db/native/timesheets.ts:86](lib/db/native/timesheets.ts) vs `listTimesheets` at [lib/db/native/reporting.ts:105](lib/db/native/reporting.ts) | **Live** |
| Ordering drift between those two copies | `log_date desc, t.id desc` [native/timesheets.ts:131](lib/db/native/timesheets.ts) vs `log_date desc, t.created_at desc` [native/reporting.ts:164](lib/db/native/reporting.ts) | **Live — latent pagination bug** |
| No index backs the admin/all-scope list sort | no `(log_date, created_at)` index in [db/migrations/](db/migrations) | **Live** |
| Exact `count(*)` runs by default on every list | [lib/db/native/timesheets.ts:115](lib/db/native/timesheets.ts) (`includeCount !== false`) | **Live** |
| Supabase user-filtered report pages all rows and sums in JS | [lib/db/supabase/reporting.ts:50-69](lib/db/supabase/reporting.ts) | Live **but on the retiring backend**; native already uses `GROUP BY` [native/reporting.ts:91-99](lib/db/native/reporting.ts) |
| `profiles(manager_id)` index for team-scope recursion | **already exists** — `profiles_manager_id_idx` [db/migrations/0006_user_hierarchy.sql:18](db/migrations/0006_user_hierarchy.sql) | **Done** — no action |

---

## Performance initiatives

Effort: S ≈ ≤1 day, M ≈ 2–4 days, L ≈ 1–2 weeks.

### P1 — Stop over-fetching the timesheet table *(highest value, architecture-independent)* — **DEFERRED (corrected scope)**

**Problem.** The dashboard downloads every timesheet the actor can see, with no bound: [page.tsx:164](app/dashboard/page.tsx) calls `getTimesheets()` with no args; the query schema sets no default or max `limit` ([timesheets.ts:33-37](packages/contracts/src/timesheets.ts)); the native adapter therefore appends no `LIMIT`/`OFFSET`. For an admin/CO this ships the entire table on every mount. It is also an unbounded response for any caller (browser or mobile).

**Correction from the original draft (verified in source).** The first draft assumed the table showed only the current month and proposed date-bounding the fetch. That is **wrong** and would regress the UI:
- `EntriesTable` renders the **full history** grouped by date and paginates **locally** (50/page, sizes 25/50/100) — [entries-table.tsx:168-190](app/dashboard/entries-table.tsx). Month-bounding would hide older entries, "Edit Last", bulk-select, etc.
- Month hours/count cover the **full calendar month and all actor-visible users** (not just the viewer, not just to today), while `loggedToday` is personal — [page.tsx:321-329](app/dashboard/page.tsx). So current-month totals cannot come from the table page.
- `ReportExport` and `TelegramPanel` consume the **same complete array** ([page.tsx:413-448,479](app/dashboard/page.tsx)); a bounded page would silently truncate CSV export and Telegram commands.
- Select-all selects the **entire filtered history**, not the visible page.
- `limit` alone cannot bound a response: the adapters let inclusive `from`/`to` ranges take precedence ([native/timesheets.ts:133-141](lib/db/native/timesheets.ts)).

**Safe staged design (see [BOUNDED_TIMESHEET_READS_DECISION_PACKET.md](BOUNDED_TIMESHEET_READS_DECISION_PACKET.md)).** Bounded **server-side** table paging (fetch only the current page, default ≤50 rows per subrequest, preserving sizes/URL state/exact count) *plus* independent month aggregates, *plus* on-demand complete CSV export, *plus* bounded Telegram history. These are activation prerequisites, not optional follow-ups — landing the cap alone would silently truncate exports, stats, and history.

**Status.** Deferred. Not implemented in this slice. **Reason.** It is not a bounded change: it requires decoupling the table page from month stats, CSV export, and Telegram, and deciding what cross-page "select all" means (a product decision). A partial cap is worse than deferral. **Effort.** M (multi-file; needs product input on selection scope). **Verify (when attempted).** Multi-page historical fixtures, page/user URL state, >1-page month totals, complete CSV, older Telegram entries, pending/error reads, overlapping mutation/filter transitions.

### P2 — Server-render the dashboard first paint

**Problem.** The dashboard is `'use client'` end to end ([page.tsx:4](app/dashboard/page.tsx)); first paint is JS-download → `onAuthStateChange` → `fetchProfile` → a fan-out of projects/activity-types/timesheets/backfill/(users/superadmin) ([page.tsx:232-242](app/dashboard/page.tsx)) plus `getDefaultLayouts`. That is an auth-gated client waterfall (~8 server round-trips, each re-running `getActor`).

**Proposal.** Convert the **initial load** to a Server Component that resolves the actor once and fetches the needed slices in parallel on the server (using the surviving domain ports / `lib/db/*` composition directly — not an HTTP hop), passing them as props to a client component that keeps all interactivity (optimistic mutations, tab state, pending-approval polling). Preserve the `classifyAccountView` pending / error / active gates.

**Impact.** ~8 browser round-trips → 1 server render; one `getActor`; content in first paint. **Effort.** L. **Risk.** Medium (largest UX-visible change). Sequence **after P3**. **Constraint note.** Server-only reads stay behind the domain ports/`auth`; no secrets to client. **Verify.** `npm run e2e` + `npm run a11y` on dashboard flows including pending-approval and profile-error; confirm optimistic add/edit/delete unaffected.

### P3 — Memoize `getActor`/`getSessionUser` per request

**Problem.** `getActor` runs on every guarded action/route and is not memoized ([lib/auth/index.ts:30](lib/auth/index.ts)). In Supabase mode it does `auth.getUser()` (a validation round-trip) **plus** a profile read on each call; a mutating action can resolve it in the guard and again in the service.

**Proposal.** Wrap `getActor` and `getSessionUser` in React `cache()` (the primitive already used in `lib/branding-server.ts`) so a single server request resolves identity once.

**Impact.** Removes duplicate validation/profile reads within a request; makes P2's single-request dashboard resolve the actor exactly once. **Effort.** S. **Risk.** Low. **Honest caveat.** `cache()` dedupes **within one server request**, not across the browser's separate HTTP calls — so on today's client dashboard it mainly removes the guard/service double-resolve; the cross-request waterfall is removed by **P2**. **Verify.** Unit test that one request reads the profile once (spy the client); auth tests green on both backends.

### P4 — (Low priority) user-filtered reports: aggregate in the DB

**Problem.** Supabase user-filtered reports page through every row and sum in JS ([supabase/reporting.ts:50-69](lib/db/supabase/reporting.ts)); native already aggregates with `GROUP BY` ([native/reporting.ts:91-99](lib/db/native/reporting.ts)).

**Re-anchored decision.** Because **`native` is the surviving backend and does this correctly**, this is only a defect on the retiring Supabase path. Options: **(a)** do nothing — the architecture plan's Phase 4 deletes `lib/db/supabase/*`; **(b)** only if the Supabase support window is long and large user-filtered reports run against it, add an **optional `p_user_id`** to `get_grouped_report_totals` in a new additive Supabase migration (keep `SECURITY INVOKER`, same grants; RLS still scopes rows) and drop the JS loop. **Recommendation: (a) defer** unless measurement during the support window shows real pain. **Constraint note.** Any change here must preserve the RLS-scoped RPC the constraints protect and must not reintroduce the removed unscoped daily-totals RPC.

---

## Database-efficiency initiatives

### D1 — De-duplicate `listTimesheets` and fix the ordering drift *(the one carried architecture item)* — **IMPLEMENTED**

**Problem.** The surviving native adapter had two near-identical list implementations with **different sort orders**: `list` ordered `log_date desc, t.id desc` ([native/timesheets.ts](lib/db/native/timesheets.ts)); the reporting copy ordered `log_date desc, t.created_at desc` ([native/reporting.ts](lib/db/native/reporting.ts)). "The same" list paginated differently depending on which path served it.

**Implementing change (this worktree).** The timesheet adapters retain the single scoped list; canonical order is now **`log_date desc, created_at desc, id desc`** in both [native/timesheets.ts](lib/db/native/timesheets.ts) and [supabase/timesheets.ts](lib/db/supabase/timesheets.ts). The reporting adapters became **factories** that receive the canonical scoped list through a required constructor parameter (`createNativeReportingPersistence(listTimesheets)`, `createSupabaseReportingPersistence(listTimesheets)`), so the duplicated list SQL and its `mapTimesheet` helper are deleted. Wiring happens at the composition roots — [lib/db/reporting.ts](lib/db/reporting.ts) and the legacy Repository facades ([lib/db/native.ts](lib/db/native.ts), [lib/db/supabase.ts](lib/db/supabase.ts)).

**Why a factory, not a direct import.** `tests/boundary-enforcement.test.ts:293-333` forbids a domain adapter importing a sibling domain adapter (even within one provider). Direct delegation failed that invariant; injecting the list at the composition root satisfies it while still removing the duplicate. Supabase scope is now the adapter's explicit scope (RLS remains the backstop), and the leader/summary path fails closed.

**Status.** Implemented on branch `perf/d1-reporting-dedup` (isolated worktree off `arch/architecture-simplification`). Focused tests in [tests/reporting-list-delegation.test.ts](tests/reporting-list-delegation.test.ts) plus scope/ordering assertions in [tests/supabase-repository-authz.test.ts](tests/supabase-repository-authz.test.ts) and the canonical-order assertion in [tests/native-repository.test.ts](tests/native-repository.test.ts). Full unit suite green (1,779 passed, 60 skipped); typecheck, lint, and `boundary-enforcement` green; native production build green. **Effort.** S. **Risk.** Low (equal-or-more-restrictive than RLS). *Note: the two direct sibling imports were attempted first and rejected by the boundary test — final source uses composition injection.*

### D2 — Add the index that backs the list sort

**Problem.** The admin/all-scope list has no `user_id` predicate and no composite index on its sort columns, forcing a sort. No `(log_date, created_at)` index exists in [db/migrations/](db/migrations).

**Proposal.** New additive migration on **both** tracks: `create index idx_timesheets_logdate_created on public.timesheets (log_date desc, created_at desc)`. Align with the canonical order chosen in D1.

**Impact.** Index-backed global list / pagination. **Effort.** S. **Risk.** Low. **Constraint note.** Additive; ships to `db/migrations/` and `supabase/migrations/`. **Verify.** `EXPLAIN` the admin list before/after.

### D3 — Compute month stats as an aggregate, not from shipped rows

**Problem.** The dashboard stat cards sum `hours`/`entries` for the current month by filtering the full client-side array — which only works because P1's over-fetch shipped everything.

**Proposal.** Serve the month totals from an aggregate query (reuse `getGroupedReportTotals` / a scoped `sum`) so the stat cards do not depend on holding every row in the browser. Pairs with P1 and P2.

**Impact.** Stat cards stop forcing a full-table client load. **Effort.** S (with P1). **Risk.** Low. **Verify.** Stat values match pre-change for seeded data; e2e.

### D4 — Make exact counts opt-in

**Problem.** `listTimesheets` runs a separate exact `count(*)` over the full scoped set by default ([native/timesheets.ts:115](lib/db/native/timesheets.ts)); the dashboard renders no total, so it is a second full scan for nothing.

**Proposal.** Pass `includeCount: false` from callers that don't display a total (dashboard, exports). Keep exact counts only for real paginators; optionally offer a `pg_class.reltuples` estimate for very large admin datasets.

**Impact.** Removes one full scan per dashboard list. **Effort.** S. **Risk.** Low. **Verify.** Confirm no UI reads a now-suppressed `count`; benchmark the list endpoint.

### Not needed (verified already done / present)

- **Narrow `getActor` profile select:** native already selects only `role, permission_role, hierarchy_role, is_active` ([native/native.ts:43-44](lib/auth/native.ts)) and the mobile actor is narrow ([mobile-actor.ts:32](lib/auth/mobile-actor.ts)). Only Supabase still does `select('*')` ([supabase.ts:29](lib/auth/supabase.ts)) — a Supabase-only, retiring-path residual; fold into P4's "do nothing / defer" or fix opportunistically.
- **`profiles(manager_id)` index:** already present (`profiles_manager_id_idx`, [0006:18](db/migrations/0006_user_hierarchy.sql)). Only verify `team_ids`/cycle-safe variant is `STABLE` so the planner evaluates it once.

---

## Roadmap

| # | Initiative | Effort | Risk | Status | Depends on |
| --- | --- | --- | --- | --- | --- |
| D1 | De-dup `listTimesheets` + canonical order | S | Low | ✅ **Implemented** (this worktree, uncommitted) | — |
| D2 | Index for the list sort | S | Low | Proposed | D1 (order) |
| P3 | Memoize `getActor` per request | S | Low | Proposed | — |
| D4 | Exact counts opt-in | S | Low | Proposed | — |
| D3 | Month stats as aggregate | S | Low | Proposed | P1 |
| P1 | Stop over-fetching the timesheet table + cap `limit` | M | Low–med | ⏸ **Deferred** (corrected scope; needs product input) | — |
| P2 | Server-render dashboard first paint | L | Med | Proposed | P1, P3 |
| P4 | Supabase report in-DB aggregation | — | — | **Defer** to Supabase-retirement decision | — |

Sequence: **D1 ✓ → D2 → P3 → D4 → D3**, then **P1** (after its prerequisites are decoupled) and **P2**. P4 is deferred. D1 shipped first because it is self-contained and parity-safe; P1 moved after D3 because its safe form requires the independent month aggregate.

## Success metrics

Capture before/after via `npm run benchmark` / `npm run load`:

- Dashboard first-load browser→server round-trips (8 → 1–2) and transferred timesheet bytes for an admin account (full-table → one month).
- `getActor` validations + profile reads per inbound request (N → 1).
- Admin list query plan (sort → index scan) and p95 latency.
- No regression in `vitest.config.mts` coverage gates; both-backend builds green; e2e + a11y green.

## Verification (maps to existing workflows)

- `npm run typecheck && npm run lint` on every change.
- `npm run test` / `test:coverage` — focused success + failure tests per behavior change; honor security-file thresholds.
- **Both backends build** (`NEXT_PUBLIC_BACKEND=supabase` and `native`) — required until the architecture plan retires Supabase.
- DB integration tests (`TEST_DATABASE_URL`) for D1/D2/D3; report skips explicitly.
- Keep the migration-parity test green ([tests/supabase-migrations.test.ts](tests/supabase-migrations.test.ts)) — preserves the RLS-scoped grouping RPC.
- `npm run e2e` + `npm run a11y` for P1/P2/D3 dashboard flows.
- Record outcomes in `docs/ai-context/ARCHITECTURE_DELTA.md`; this plan is a proposal, not an implemented change.

## Reconciliation with the first draft

| First draft (`docs/plan/`, vs `main`) | Fate here | Reason |
| --- | --- | --- |
| "Collapse three HTTP surfaces onto `/api/v1`" | **Dropped** | Done by architecture plan Phase 3 |
| "Converge on one `pg` data layer / point native at Supabase PG" | **Dropped** | Conflicts with decided direction (native survives, Supabase retires entirely) |
| "Repository contract implemented twice" framing | **Dropped** | `Repository` was vestigial and is removed (Phase 1) |
| "Contain migration/idempotency machinery" | **Dropped** | Owned by architecture plan Phases 2 & 4 (now `tools/migration/`) |
| De-dup `listTimesheets` | **Kept → D1** | Targets surviving native adapter; also fixes an ordering bug |
| getActor memoization | **Kept → P3** | Still unmemoized on arch branch |
| Dashboard over-fetch / SSR | **Kept → P1/P2** | Still live; architecture-independent |
| Ordering/index/count hygiene | **Kept → D2/D4** | Still live |
| Supabase report JS-paging fix | **Demoted → P4 (defer)** | Retiring backend; native already correct |
| Narrow `getActor` select; `manager_id` index | **Removed** | Already done on surviving path |
