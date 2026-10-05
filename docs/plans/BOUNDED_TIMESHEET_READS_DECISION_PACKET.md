# Bounded timesheet reads — implementation decision packet

Baseline: `0cf125a`, worktree `claude/fervent-goodall-78411e`. This packet corrects the scope assumptions in `PERFORMANCE_AND_DB_EFFICIENCY_PLAN.md`; no P1 completion is claimed.

## Decision required

How can report reads share the canonical timesheet list without crossing domain-adapter boundaries, and how can the browser stop fetching all history without silently truncating other features?

## Verified evidence

- **FACT:** `tests/boundary-enforcement.test.ts:293–333` forbids reporting adapters importing timesheet adapters, even within one provider. Direct delegation initially failed this invariant (full suite: 1 failed, 1752 passed, 86 skipped). Preserve this test.
- **FACT:** `lib/db/reporting.ts` is the server composition root. It may import both domain adapters and wire dependencies. `ReportingPersistence` retains `getGroupedReportTotals` and `listTimesheets`.
- **FACT:** `native/timesheets.ts` and `supabase/timesheets.ts` own scoped list implementations. Canonical order selected: `log_date DESC, created_at DESC, id DESC`. SQL/RLS scope and resource filters must still apply.
- **FACT:** `EntriesTable` displays full history, locally filters users and paginates; select-all selects the entire filtered array, not just its page. Its URL state is `user/page/size`.
- **FACT:** Dashboard month hours/count cover the full calendar month and all actor-visible users, whereas today's logged indicator is personal. Month-only list replacement changes semantics.
- **FACT:** `ReportExport` and `TelegramPanel` consume the same complete array. Passing a bounded table page would silently truncate both.
- **FACT:** Mobile lists already request 25-row pages and require exact matching counts. `limit` alone cannot bound HTTP responses because inclusive `from/to` ranges take precedence.
- **UNKNOWN:** Production consumer inventory, production query plans and timing. Unit/fixture checks cannot establish live authorization or latency improvements.

## Constraints and acceptance

Preserve domain ports, both backend builds, actor/role-axis semantics, native SQL authorization and Supabase RLS/bearer context. Preserve exports/history access and optimistic mutation recovery. No applied migration changes, provider retirement, auth-cache changes, or SSR work in this slice.

## Alternatives and selected protocol

### D1 — selected: injection at composition

Expose provider reporting factories receiving the existing typed list operation. Wire them with the same provider's timesheet list in `lib/db/reporting.ts` and the legacy Repository facades. Reporting adapters must not import sibling domain adapters; factories require a list dependency, with no bypass/fallback. Public Repository/action/HTTP contracts remain unchanged. Verify delegation, canonical ordering, scope, failed scope resolution, export paging and boundary enforcement.

Rejected: direct sibling imports (fails the existing boundary invariant); weakening boundary checks; duplicating list SQL; an unconfigured/no-op list default.

### P1 — scoped design, awaiting implementation

Separate server-paged all-date table rows from independent month aggregates, personal today-presence, on-demand complete CSV export and bounded Telegram history. Preserve exact count for real paginators. Bound effective HTTP page sizes (default, limit and inclusive range), not only explicit limit. Recheck omitted-pagination consumers before introducing a default cap.

Selection scope must be explicitly decided and visible: selecting a server page is not equivalent to the current all-filtered-history select-all. No silent scope change.

## Lifecycle checks

- Activation: first table request is bounded; historical navigation/user filters remain available; totals are independent of page size.
- Completion: committed mutations refresh rows and stats; temporary IDs remain non-actionable.
- Recovery: rejected writes restore drafts/rows; failed reads show errors rather than successful partial exports.
- Retries: preserve existing idempotency/mutation behavior; read de-duplication must not reuse pre-write truth.
- Stale artifacts: a response for an older page/filter/session cannot overwrite current state.
- Concurrent transitions: parent-owned mutation locks survive tab changes; page/filter switches cannot merge unrelated overlays or counts.

## Verification

Focused delegation/scope/order tests, boundary suite, full unit/coverage gates, lint, typecheck and both backend builds. P1 additionally needs multi-page historical fixtures, page/user URL state, more-than-one-page month totals, complete CSV, older Telegram entries, pending/error reads and overlapping mutation/filter transitions. Database/Playwright checks require their configured environments; report all skipped/unavailable legs.
