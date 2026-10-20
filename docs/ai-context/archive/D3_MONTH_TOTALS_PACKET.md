# D3 — Independent dashboard month aggregates

## Decision and scope

Use the existing browser-authorized report aggregate for month hours/count,
instead of reducing the table's complete-history array. Preserve table/history,
CSV, Telegram, personal Today status and optimistic entry mutations. No provider
operations, auth-cache changes, new persistence port, schema or server API.

## Verified evidence

- FACT: `app/dashboard/page.tsx` calculates month hours/count from `timesheets`;
  `fetchTimesheets` reconciles after create/edit/delete/import/restore/backfill.
- FACT: `dataClient.getReportTotals` sends `from/to/groupBy` to `/api/v1/reports`.
  That route admits browser cookies with the existing active-actor guard.
- FACT: `lib/domain/reporting.ts:getReportTotals` returns scoped totalHours and
  totalEntries from grouped buckets. Native uses SQL; Supabase's no-user-filter
  path uses the RLS-scoped `get_grouped_report_totals` RPC. Do not add userId.
- FACT: current month follows local `todayISO()`, including future-dated rows
  through month end; personal Today status is distinct from all-visible totals.
- FACT: browser reads deduplicate in-flight requests. Post-write refresh must
  await prior reads before issuing a fresh request, never adopt pre-write truth.

## Protocol and lifecycle

Read explicit local-calendar month bounds through the existing aggregate.
Use server-confirmed totals and mark loading, refresh and failure visibly.
Do not label failed/unavailable aggregates as successful zero. Optimistic entry
rows remain interactive with the existing mutation/rollback protocol.

Refresh totals after mutations using existing parent callbacks, independently
of successful table-page reads. Discard stale successes and errors after a newer
refresh, logout or session transition. Clear totals on identity changes. Keep
table and aggregate error handling separate so either can recover independently.
Do not derive totals from returned page size or restrict the full history list.

## Alternatives and acceptance

Rejected: cap the shared history array (truncates export/Telegram), aggregate
via service role, new duplicate DB query implementation, fabricated zero fallback.
Verify leap/year/month boundaries, >one-page totals, stale success/error, failed
refresh, session reset and post-write singleflight avoidance with controlled
promises; verify existing report authorization/client tests. Run lint/typecheck,
unit coverage and both backend builds on the settled patch. Installed-device,
database and authenticated E2E/a11y checks require their configured environments;
report unavailable checks explicitly. Production latency remains unmeasured.

P1's cross-page selection policy is a separate product decision. P2 follows P1;
React auth memoization is reconsidered only when its RSC consumer exists.

## Verification and finding ledger

- D3-R1 (independent reviewer, confirmed): a controller's retained flight did
  not survive remount, so the global browser singleflight map could join a
  previous account's still-running report GET. Fixed with optional
  `getReportTotals(query, { deduplicate:false })`; dashboard alone uses direct
  authenticated transport, preserving report defaults and response validation.
  Per-controller generations/serialization still discard stale results and
  wait out pre-write reads. Actual-facade regressions instantiate successive
  Alice/Bob controllers with the same report URL and delayed fetches; Bob
  launches a separate GET and never publishes Alice's late success/error.
  Default report deduplication and bypassed HTTP-error behavior are covered.
- PASSED: final settled patch, 8 focused suites / 95 tests: controller,
  actual-facade cache/remount, both browser-client modes, optimistic rows,
  reporting domain and browser/mobile report authorization. `git diff --check`
  and final scoped diff inspection passed. Write ownership returned to root.
- PASSED: 29 controller/transport tests after D3-R1 repair, including complete
  local/leap/year month ranges, aggregate counts beyond page size, confirmed
  zero versus errors, recovery, overlapping generations, busy-row deferral,
  logout/direct session reset and two-controller remount isolation.
- PASSED: modified-file ESLint (zero warnings/errors) and Serena TypeScript
  diagnostics for page, helper, facade and tests (no errors). Initial targeted
  runs caught an incorrect Alert prop and an asynchronous test assertion;
  both were corrected before the final focused checks.
- Implementation: month cards consume confirmed aggregate totals exclusively;
  loading/error clears old values and exposes a retry. Personal Today still
  uses the original row predicate. Initial/profile refresh and existing
  create/edit/delete/backfill/import/restore/reset callbacks refresh aggregates
  independently of row results. Existing row reconciliation/rollback behavior,
  complete history, CSV, Telegram, server/API/persistence and D2 remain intact.
- SKIPPED in worker batch per root instructions: full lint/typecheck, coverage,
  production builds, authenticated E2E/a11y, live database tests and benchmarks.
  No production latency claim. Root owns final integration/closure review.
