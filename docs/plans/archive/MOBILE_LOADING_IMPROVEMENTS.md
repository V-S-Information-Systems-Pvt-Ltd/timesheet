# Mobile loading decision packet

> Archived 2026-10-04 as supporting reference. Recorded evidence, contracts and
> unverified limitations retain their scope; this move marks no pending check complete.
> Current work follows the [active plans](../../README.md#active).

## Decision and acceptance

Reduce duplicate dashboard/reference requests and settings reloads without changing
authentication, server APIs, persistence, or the startup restore protocol. Reuse
successful reads for 30 seconds within the current provider/session; explicit
refresh and successful mutations bypass reuse. Concurrent ordinary reads share a
request. A superseded response must never overwrite newer data.

## Verified evidence

- FACT: `SessionProvider.loadDashboard` always fetches; `HomeScreen` and
  `TimeEntryForm` can request it concurrently. Reference reads share only pending
  requests (`mobile/src/auth/SessionProvider.tsx`, `loadReference`).
- FACT: Timesheet/leave mutations reload the dashboard; reference administration
  mutations reload reference data (`mobile/src/auth/domains/`). These reloads must
  remain fresh even if an earlier read is pending.
- FACT: `SettingsAdminScreen.fetchData` depends on selections and reference while
  also updating them, retriggering its loading effect.
- FACT: Session logout/error clears displayed data. Existing dashboard offline
  cache is isolated by server and actor and has a five-minute TTL.
- INFERENCE: Reducing request count and reusing recently fetched data reduces
  repeated-navigation latency. Actual installed-app timing is UNKNOWN: native
  controls are available through the Computer Use runtime, but no timings were
  collected during the recorded Computer Use checks. The user confirmed that
  work item completed on 2026-10-03 without supplying timing samples.

## Alternatives and constraints

Choose a small provider-owned read cache plus functional selection defaults.
Avoid global HTTP caching because manual refresh and mutation invalidation differ
by endpoint. Avoid changing session restoration/auth checks without live evidence.
Keep existing offline dashboard fallback; the new cache is memory-only and stores
no credentials. No server/backend contract or database changes are needed.

## Lifecycle and verification

Activation starts with empty caches. Normal completion stores a result for 30
seconds. Failed reads are not cached and allow retry. Forced reads invalidate
cached/pending results before requesting new data. Signout, account/workspace
changes, auth error, and unmount invalidate pending results. Old responses and
failures must not update state after invalidation or replace a forced refresh.

Verify successful reuse, expiry, failure/retry, forced mutation refresh during an
older request, signout/workspace isolation, and settings loading/selection changes.
Run focused tests during repair, then mobile lint, types, shared unit suite, and
Windows Jest suite. Installed Windows measurements remain unrecorded after the
user confirmed Computer Use completed. Rollback needs no migration or deployment.

## Verification results

- Mobile and Windows Jest workflows: each passed 48 suites / 296 tests, including
  10 new cache/loading tests. Source-level closure review found no correctness defect.
- Mobile TypeScript passed. Mobile lint passed with 45 existing warnings; changed
  cache/test files passed focused lint. Relevant diff whitespace checks passed.
- Windows production bundle and unsigned x64 release package built successfully
  (15 build warnings, zero errors). Artifact:
  `mobile/build/windows/VsisTimesheetMobile.Package_1.1.1.0_x64.msix`.
- The original loading change did not collect installed-device timings. Native
  controls were subsequently used for Windows acceptance on 1.1.5 and 1.1.6;
  those visual checks do not establish loading latency.

## Ordered follow-up — 2026-10-03

Current-source regression verification passed in the standard mobile workflow:
3 suites / 13 tests, with the same 3 suites / 13 tests passing in the Windows
workflow, covering
concurrent request sharing, cache expiry, failure/retry, forced refresh,
late-response suppression, logout/workspace isolation, settings selection without
refetch, and the offline dashboard cache. No loading code change was needed.

The user confirmed the Computer Use work item completed on 2026-10-03; no further
native interactions are scheduled. Device timing remains unmeasured. If a future
performance measurement task is requested, record the installed
version, backend and connection conditions, cold launch to usable Home, repeated
Home/Form navigation within and beyond 30 seconds, explicit refresh, and a
successful mutation refresh. Use several samples and record median/range plus
request counts where observable. Treat offline fallback separately. Compare only
like-for-like runs; Jest runtime and automation overhead are not device timings.
