# Performance and Efficiency Improvement Plan

## Execution owner

This plan is written for Gemini Flash 3.7 running in Antigravity against
`C:\dev\timesheet-mobile`. It is an implementation plan, not authorization to
apply every optimization. Each phase starts with measurement and ships only
changes that satisfy its stated benchmark gate.

Before implementation, read `AGENTS.md`, the relevant Next.js 16 guide under
`node_modules/next/dist/docs/`, and create
`docs/plans/performance-efficiency-improvement-notes.md` with a `## Deviations`
section. Record every code-forced deviation and the evidence for the final
outcome there.

Treat this document as a program roadmap, not one change set. One Antigravity
run must implement only one execution slice from `## Execution Slices`, or the
named tracer bullet within that slice. Finish its verification and record its
result before starting another slice. Do not combine unrelated web, mobile,
database, and infrastructure findings merely because they share a phase.

## Executive Summary

The application is a Next.js 16/React 19 web app and a React Native 0.84 mobile
app sharing a versioned REST API and a dual-backend repository abstraction.
The repository already contains several sound performance choices: static web
page shells, pooled native PostgreSQL access, SQL-side report aggregation,
bounded/paginated list APIs, React Native `FlatList` virtualization, memoized
list cards, self-hosted fonts, a standalone container build, and a k6 workload.
Those areas should not be rewritten merely to conform to a generic best
practice.

The highest-confidence problems are narrower and code-backed:

- mobile pagination requests an `offset` that is absent from the contract and
  never sent, so “load more” re-fetches page one;
- `/api/health` creates and destroys a fresh PostgreSQL pool for every
  readiness and liveness probe, while both probes use the same dependency-aware
  endpoint;
- native web builds still ship Supabase and Zod client chunks; the measured
  `/dashboard` raw client JS referenced by prerendered HTML is about 1,234 KB;
- dashboard/report paths make avoidable requests and exact-count queries;
- mobile bulk operations are sequential N-request workflows and each mutation
  triggers another dashboard request;
- bulk editing and backup restore contain query-per-row loops;
- every authenticated mobile API request performs two sequential database
  lookups before business work;
- current observability cannot establish route, query, mobile-startup, render,
  or resource baselines, so many lower-priority changes must remain hypotheses.

Priority order is therefore: establish evidence, fix range pagination and probe
resource behavior, remove dominant round trips and N+1 paths, reduce client
bundles and client-side dataset processing, then tune rendering, caching,
database indexes, deployment scaling, and CI only where measurements justify
them.

## Current Architecture

### Runtime boundaries

```text
Web browser
  -> statically prerendered client-heavy App Router pages
  -> Server Actions for mutations and /api/data/* for native reads
  -> direct Supabase browser reads in supabase mode

React Native (Android/iOS/Windows)
  -> custom reducer-based navigator + SessionProvider
  -> /api/v1/* bearer-token REST API
  -> API service modules

Server Actions and route handlers
  -> lib/db/repository.ts
  -> lib/db/native.ts -> lib/db/pool.ts -> PostgreSQL
  OR
  -> lib/db/supabase.ts -> Supabase/PostgREST/RPC -> PostgreSQL + RLS
```

- Web pages: `app/page.tsx`, `app/dashboard/page.tsx`, and
  `app/reports/page.tsx` are Client Components. `app/layout.tsx` remains a
  Server Component and supplies local Geist fonts and the global toaster.
- Web reads: `lib/data/client.ts` selects a direct browser Supabase adapter or
  same-origin `/api/data/*` adapter at build time. It deduplicates only
  concurrent identical native requests; settled results are not cached.
- Web writes: `app/actions.ts` is a stable Server Action barrel over
  `app/actions/*`; actions authenticate, rate-limit, validate, call `repo`, and
  often await a separate audit write.
- Mobile: `mobile/App.tsx` uses a reducer and a switch to mount one screen.
  `mobile/src/auth/SessionProvider.tsx` owns authentication, network methods,
  dashboard/reference data, offline/sync state, and exposes one large context.
- Mobile API: `app/api/v1/*` authenticates access tokens through
  `requireMobileActor`, then calls `lib/api/v1/services/*`, then `repo`.
- Database: `lib/db/repository.ts` defines parity across native PostgreSQL and
  Supabase. Native uses a process pool capped at 10 connections and runs
  migrations on first query. Supabase uses RLS for user-scoped operations and
  selected RPCs for aggregates.
- Deployment: Vercel serves Supabase mode. Native mode uses a Next.js standalone
  image on Docker/OpenShift/Rancher. Kubernetes currently declares one replica,
  100m CPU request, 256 MiB memory request, and 512 MiB memory limit.
- CI: GitHub Actions runs root lint/tests/coverage, typecheck, two backend
  builds, native Playwright, and a Docker build. Mobile lint/typecheck/Jest and
  performance budgets are not CI gates.

### Data flow characteristics

- Dashboard web startup waits for auth/profile, then starts projects, activity
  types, timesheets, profiles, settings, and super-admin checks as separate
  calls (`app/dashboard/page.tsx:107-193`).
- Mobile dashboard performs two sequential `listTimesheets` calls
  (`lib/api/v1/services/dashboard.ts:23-35`); each adapter also performs an
  exact count even though dashboard ignores it.
- Web reports page loads timesheet pages into browser memory and performs
  filtering, summaries, comparisons, missing-day detection, and exports in the
  browser (`app/reports/page.tsx:128-367`). An existing grouped-report service
  already aggregates in SQL (`lib/api/v1/services/reports.ts:40-48`).
- Native `listTimesheets` issues a count query and a joined row query, with
  offset pagination ordered only by date (`lib/db/native.ts:340-397`).
- Mobile authentication verifies JWT locally, then reads `mobile_sessions`,
  then reads `profiles` (`app/api/v1/_http.ts:34-58`) before route work.

## Performance Baseline Required

No production latency traces, Core Web Vitals, React render profiles, native
startup traces, database plans, connection saturation metrics, or resource
time series are committed. The k6 suite has a broad `p(95)<2000` ms and `<1%`
failure threshold, but only exercises native web login and one timesheet read.
Therefore, code evidence identifies round-trip complexity, payload risk, and
resource churn; it does not prove current production P50/P95 latency.

Capture and retain these artifacts before Phase 1:

1. Web builds in both backend modes: build duration, route classification,
   raw/gzip/Brotli JS by route, largest modules, and standalone image size.
   Use `npm run build` and `npx next experimental-analyze --output` with the
   correct mode-specific environment.
2. Browser traces for `/`, `/dashboard`, and `/reports`: TTFB, FCP, LCP, INP,
   transferred JS, request count, hydration duration, long tasks, and memory at
   100/1,000/10,000 visible/report rows.
3. API timings for auth, dashboard, reference, paginated timesheets, grouped
   reports, bulk operations, and health probes. Record P50/P95/P99, throughput,
   response bytes, database statement count, and error rate by backend.
4. React DevTools profiles for dashboard state changes, report filter changes,
   and mobile context updates. Record commit count and render duration.
5. Release-mode mobile traces on representative low/mid devices: cold start to
   first interactive frame, warm start, JS bundle evaluation, JS/UI FPS, dropped
   frames, peak/resident memory, screen transition duration, list scrolling,
   offline flush, and network bytes. Use Android Perfetto/Studio, Xcode
   Instruments, and Windows Performance Recorder as applicable.
6. PostgreSQL plans at representative cardinalities (10k, 100k, and 1m
   timesheets): `EXPLAIN (ANALYZE, BUFFERS)` for list, count, report, team, session
   cleanup, and project-filter queries. Capture `pg_stat_statements`,
   `pg_stat_activity`, lock waits, dead tuples, and autovacuum/analyze timestamps
   when the environment permits.
7. CI wall time and billed runner minutes per job, cache hit rate, install time,
   build time, Docker build time, Playwright time, and mobile verification time.

The repository scan produced two reproducible local reference points, not
production budgets:

- `NEXT_PUBLIC_BACKEND=native npm run build`: Next.js 16.3/Turbopack compiled in
  5.5 s and TypeScript completed in 2.7 s; all four UI routes were statically
  prerendered and API routes were dynamic.
- Android release bundle generated with `react-native bundle`: 1,182.7 KB raw,
  288.7 KB gzip, zero image assets. Preserve the exact machine/commit when
  comparing this value.

Audit source state: repository `HEAD` `8811db8`, reviewed on 2026-08-30. The
build and bundle numbers above are observations from that source state, not
committed benchmark artifacts or production targets. Phase 0 must regenerate
and retain them before using them for an acceptance decision.

## Scope Boundaries

### In scope

- Correct the proven pagination and health-probe defects.
- Establish the minimum measurement needed to decide each optimization.
- Remove code-backed request, query, serialization, bundle, and persistence
  waste while preserving dual-backend behavior and authorization.
- Add only the production controls needed to deploy and roll back an accepted
  optimization safely.

### Deferred unless a benchmark promotes them

- Cursor/keyset pagination beyond repairing the current numeric range contract.
- A broad Server Component/RSC rewrite, global state library, global data cache,
  new list virtualizer, navigation framework replacement, or image cache.
- HPA/multi-replica rollout, PgBouncer, distributed rate limiting, or autovacuum
  tuning before traffic, connection, and database evidence exists.
- Candidate indexes, RLS rewrites, or `select('*')` replacements without plans,
  consumer-field evidence, and write/storage measurements.
- A telemetry vendor or generic observability abstraction before ownership,
  retention, privacy, and platform support are decided.
- Unrelated UI redesign, feature work, dependency upgrades, and cleanup of
  unused starter assets.

There is no application `middleware.ts` or `proxy.ts` in the reviewed source,
so middleware optimization is out of scope until one exists or route traces
show an equivalent interception layer.

## Assumptions and Evidence Status

| ID | Assumption or claim | Status | Evidence / invalidation rule |
| --- | --- | --- | --- |
| A01 | Native health checks create a new pool while both Kubernetes probes call the same route. | Verified | `app/api/health/route.ts:12-27`, `deploy/deployment.yaml:39-50`; invalidate only if those files change before S1. |
| A02 | Mobile load-more does not send its `offset`, while the server expects numeric `from`/`to` range offsets. | Verified | `TimesheetListScreen.tsx:72-95`, mobile contract/client, `timesheetQuerySchema`, and v1 route; re-run the contract test if any endpoint changes. |
| A03 | `npx next experimental-analyze --output` is supported by the installed Next.js version. | Verified | Local Next.js 16.3 CLI guide, `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md:255-273`. |
| A04 | Dashboard reads are sequential in mobile and list adapters always request an exact count. | Verified | `lib/api/v1/services/dashboard.ts:23-35`, `lib/db/native.ts:367-395`, `lib/db/supabase.ts:237-269`. |
| A05 | Protected mobile requests perform separate session and actor lookups. | Verified | `app/api/v1/_http.ts:34-58`, `lib/auth/mobile-session-store.ts`, `lib/auth/mobile-actor.ts`. |
| A06 | Native web bundle contains Supabase and Zod client chunks at the observed sizes. | Observed; must revalidate | Local audit output was not retained as a committed artifact. S0a must reproduce analyzer and compressed-size artifacts in both modes; if absent, narrow or close F04. |
| A07 | Production-like data can be obtained safely at 10k/100k/1m cardinalities. | Unverified operational prerequisite | If unavailable, do not make index, cursor, restore-scale, or vacuum decisions; use the largest representative sanitized dataset and mark confidence limits. |
| A08 | A telemetry provider, retention policy, and alert owner are available. | Unverified and non-blocking for S0a/S0b | S0a captures existing-tool artifacts and S0b uses dependency-free local timing. Vendor telemetry stays deferred until owners decide. |
| A09 | Database connection capacity and intended replica count are known. | Unverified operational prerequisite | F11 may add metrics/timeouts, but must not enable multi-replica/HPA or a pooler without this capacity budget. |
| A10 | Deployed mobile clients can consume additive v1 contracts during a compatibility window. | Unverified release prerequisite | Keep current endpoints working; if adoption/version data is unavailable, do not remove old request/response forms. |
| A11 | Restore atomicity/resumability policy may differ between native and Supabase. | Verified unresolved product/operations decision | Preserve current behavior during measurement. Any semantic change is a STOP condition until an owner selects parity requirements. |
| A12 | Android, iOS, and Windows support exists for any proposed storage dependency. | Unverified dependency prerequisite | No storage dependency is selected in this plan. A platform spike and installed-device proof must precede adoption. |

## Cross-cutting Failure Contracts

These rules apply to every slice and close failure-path ambiguity without
inventing a new framework:

| Boundary | Required behavior |
| --- | --- |
| Instrumentation | Logging/metric export failure never fails a user request. Buffers and payloads are bounded, sampled, redacted, and non-blocking. |
| Liveness/readiness | Liveness performs no dependency call. Readiness has an explicit timeout, returns non-2xx on dependency failure, uses `getPool()` without `ensureMigrated()`, and cannot consume unbounded pool slots. Migration readiness is a separately approved concern. |
| Timesheet range pagination | `from` and `to` are integer offsets, `to` is inclusive, `0 <= from <= to`, and page size is bounded. A failed append preserves existing rows and exposes retry; it never advances local pagination state. |
| Batch APIs | Request-level validation/auth failures return the existing v1 error envelope and change nothing. Accepted batches preserve input order, return one deterministic result per item, bound batch size, and refresh client state once. Retry/idempotency behavior must be specified before offline batching ships. |
| Combined auth lookup | Fail closed. Revoked, expired, rotated, missing, and inactive cases must produce the same externally visible status/error behavior as before. |
| Cache/storage | Cache read/write failure falls back to the authoritative network path. Cache data is versioned and reconstructible; pending mutations and credentials are never silently discarded. Logout clears actor-scoped data. |
| Report/export | Validate authorization and filters before starting output. If generation fails before headers, return the normal error envelope; if a stream fails after headers, terminate it, log the request ID, and make the client discard the partial download. |
| Restore/migrations | Never edit an applied migration. A failed forward migration is fixed forward. Restore optimizations preserve current backend semantics until A11 is resolved and must remain idempotently retryable. |
| Client adapter split | A build is invalid if either backend imports server-only code into the client or if the inactive backend remains in the measured client graph after the slice claims removal. |

## Findings

Each finding supplies the ten requested implementation fields. “Expected
benefit” is qualitative unless a measured baseline exists; changes do not ship
solely because a best-practice document recommends them.

### F01 — Capture reproducible baselines with minimal instrumentation

- **Priority / class:** P0; Infrastructure/configuration improvement; Quick win.
- **1. Current behavior:** server logs cover selected errors/rate-limit events;
  mobile telemetry is an in-memory 100-event buffer; there are no route/query
  duration metrics, distributed traces, Web Vitals collection, crash reporting,
  alert thresholds, or stored mobile performance events.
- **2. Evidence:** `lib/logger.ts:33-59`, `app/api/v1/_http.ts:15-19`,
  `mobile/src/telemetry/telemetry.ts:20-68`, and the absence of observability
  configuration under `.github/`, `deploy/`, `app/`, and `mobile/`.
- **3. Performance impact:** regressions and saturation cannot be localized or
  ranked; speculative changes may consume engineering time without improving a
  user-visible bottleneck.
- **4. Root cause:** existing logging records selected events but does not retain
  comparable request, render, query, startup, or resource measurements.
- **5. Recommended optimization:** S0a first captures everything available from
  existing build, browser, k6, PostgreSQL, React, and platform tools without a
  production-code change. S0b adds dependency-free request ID and structured
  duration/response-size/database-call metadata to one representative protected
  v1 route as a tracer. Expand one boundary at a time only after overhead passes;
  add Web Vitals and release-mode mobile profiling instructions as separate
  artifact capture, not one horizontal telemetry layer. Full tracing, crash
  reporting, dashboards, and a vendor remain a later production-readiness slice.
- **6. Expected benefit:** a trustworthy baseline and a proven low-overhead
  instrumentation pattern to accept, reject, or re-prioritize F02-F18 without
  blocking on a vendor integration.
- **7. Implementation complexity:** Low for S0a and Low-Medium for S0b; provider rollout is a
  separate Medium-High slice.
- **8. Risk:** Medium; telemetry can add CPU/network cost or expose sensitive
  data. Sample high-volume events and prohibit tokens, passwords, work text, and
  raw backup payloads.
- **9. Dependencies:** none for local baseline capture. Production export depends
  on provider, retention, SLO ownership, privacy review, and alert routing.
- **10. How to benchmark before and after:** compare instrumentation off/on at
  50 VUs and during mobile startup. Record CPU, RSS, response bytes, event loss,
  and JS-frame stalls; keep only instrumentation whose overhead is below the
  agreed budget or measurement noise.

### F02 — Split liveness from readiness and reuse the native pool

- **Priority / class:** P0; Infrastructure/configuration improvement; Quick win.
- **1. Current behavior:** every `/api/health` native request constructs a new
  `pg.Pool`, runs `select 1`, and ends the pool. Kubernetes calls that same
  dependency-aware endpoint every 10 seconds for readiness and every 30 seconds
  for liveness.
- **2. Evidence:** `app/api/health/route.ts:12-27` and
  `deploy/deployment.yaml:39-50`; the application already has a reusable pool at
  `lib/db/pool.ts:21-33`.
- **3. Performance impact:** repeated connection/TLS/auth setup consumes
  PostgreSQL and Node resources. A database outage also makes liveness fail,
  causing avoidable restart loops rather than only removing the pod from
  service.
- **4. Root cause:** one endpoint mixes process health, dependency readiness,
  and detailed diagnostics, and bypasses the shared pool.
- **5. Recommended optimization:** make liveness a cheap process-only endpoint;
  make readiness dependency-aware and use `getPool().query(...)` directly, not
  the repository `query()` wrapper that calls `ensureMigrated()`. This preserves
  the current reachability-only health semantics while eliminating per-probe
  pools. Use a timeout/cancellation mechanism supported by the installed `pg`
  version so a timed-out probe does not leave background work. Keep detailed
  diagnostics internal and treat migration/startup readiness as a separate,
  explicit deployment decision.
- **6. Expected benefit:** bounded connection churn, fewer restart storms, and
  more accurate orchestration behavior.
- **7. Implementation complexity:** Low.
- **8. Risk:** Low-Medium; consuming pool slots during saturation can still harm
  traffic, and accidentally calling `ensureMigrated()` would change startup
  semantics.
- **9. Dependencies:** `lib/db/pool.ts`, deployment manifests, Docker healthcheck,
  and platform probe policy.
- **10. How to benchmark before and after:** observe `pg_stat_activity` during 10 minutes of probe traffic
  and during a simulated DB outage. New connections per probe should fall to
  zero after pool warm-up; DB outage must mark readiness false without restarting
  a healthy Node process.

### F03 — Repair the mobile numeric range-pagination contract

- **Priority / class:** P0; Quick win.
- **1. Current behavior:** `TimesheetListScreen` passes `{ offset }`, but
  `TimesheetListParams` has no `offset`; `ApiClient.listTimesheets` never sends
  it; the route accepts numeric `from`/`to`. Load-more therefore requests the
  first page again and deduplicates it in JavaScript.
- **2. Evidence:** `mobile/src/screens/TimesheetListScreen.tsx:72-95,122-127`,
  `mobile/src/api/contracts.ts:115-122`, `mobile/src/api/client.ts:106-118`, and
  `app/api/v1/timesheets/route.ts:13-30`.
- **3. Performance impact:** repeated network/auth/count/query work, no forward
  progress for lists larger than one page, and wasted JS set/filter work.
- **4. Root cause:** client terminology diverged from the repository/API
  `from`/`to` contract; TypeScript did not reject the spread-in extra property.
- **5. Recommended optimization:** change mobile `TimesheetListParams.from/to`
  to numeric offsets, serialize them when `!== undefined`, and have the screen
  request `from = entries.length` and `to = from + PAGE_SIZE - 1`. Keep the v1
  server/repository contract unchanged. Add contract/client/screen regression
  tests for first page, second page, invalid ranges, append failure, and end of
  list. Evaluate keyset pagination only under F14 if deep-offset plans miss an
  approved target.
- **6. Expected benefit:** correct infinite scrolling with one request per page
  and no duplicate-page filtering work.
- **7. Implementation complexity:** Low.
- **8. Risk:** Low-Medium; the mobile contract currently types `from/to` as
  strings, so tests must catch accidental date-range semantics or omitted zero.
- **9. Dependencies:** existing v1 `timesheetQuerySchema`,
  `TimesheetListOptions`, mobile API/client tests, and seeded page fixtures. No
  migration or server API version is required for the repair.
- **10. How to benchmark before and after:** seed more than three pages and
  capture requested URLs, returned IDs, requests, bytes, and list-query time.
  Under a fixed dataset, each page must advance by `PAGE_SIZE` without overlap;
  page two must send the numeric inclusive range exactly once.

### F04 — Remove inactive backend and validation libraries from client bundles

- **Priority / class:** P1; Refactor; Quick win for client-only validation.
- **1. Current behavior:** `lib/auth/client.ts` and `lib/data/client.ts` statically
  import Supabase and construct both adapter objects before choosing with
  `IS_NATIVE`. Client pages also import shared Zod schemas for password checks.
  The native build references a 273.3 KB raw Supabase/PostgREST chunk and a
  280.1 KB raw Zod chunk; `/dashboard` references about 1,234 KB raw JS.
- **2. Evidence:** `lib/auth/client.ts:9-10,30-191`,
  `lib/data/client.ts:9-12,71-344`, `app/page.tsx:7`,
  `app/change-password/page.tsx:9`, `app/dashboard/add-user-form.tsx:11`, and the
  production build chunk inspection recorded in this audit.
- **3. Performance impact:** extra download, parse, compile, memory, and startup
  work in native web deployments; Zod also reaches routes needing only a small
  password predicate.
- **4. Root cause:** runtime ternary selection does not guarantee build-time
  elimination of statically imported modules, and server/client validation
  concerns share one module.
- **5. Recommended optimization:** prove import chains with Next 16 analyzer;
  split client adapter entry points so the selected build mode resolves only one
  implementation, while preserving the public `AuthClient`/`DataClient`
  interfaces. Keep Zod server-side and expose a tiny dependency-free client
  password-policy predicate/constants module. Do not duplicate validation rules
  without a shared test.
- **6. Expected benefit:** materially smaller native client routes and less JS
  evaluation; exact gain equals eliminated gzip/Brotli modules.
- **7. Implementation complexity:** Medium.
- **8. Risk:** Medium-High; build-time mode selection can break dual-backend CI
  or accidentally expose server modules. Avoid a new generic plugin/loader if a
  direct mode-specific entry point or supported alias suffices.
- **9. Dependencies:** Next.js 16 bundling docs, dual-mode builds, environment
  contract, and auth/data adapter parity tests.
- **10. How to benchmark before and after:** compare analyzer output and raw/gzip/Brotli route chunks in
  both modes. Native client graphs must contain neither Supabase nor server Zod;
  both modes must pass production build and end-to-end auth/data flows.

### F05 — Collapse dashboard startup fan-out and remove unused exact counts

- **Priority / class:** P1; Architectural improvement and Database optimization.
- **1. Current behavior:** web dashboard waits for auth/profile and then starts
  up to six separate data/action calls. Mobile dashboard performs two sequential
  timesheet list calls. Every list call performs an exact count even when callers
  use only rows.
- **2. Evidence:** `app/dashboard/page.tsx:107-193`,
  `lib/api/v1/services/dashboard.ts:23-35`,
  `lib/db/native.ts:367-395`, `lib/db/supabase.ts:237-265`, and dashboard
  destructuring only `rows`.
- **3. Performance impact:** extra network/auth/RLS round trips, duplicate count
  scans, slower first useful dashboard, and higher DB concurrency.
- **4. Root cause:** dashboard composition evolved from independent panels; the
  repository list result always includes count regardless of caller need.
- **5. Recommended optimization:** add an explicit `includeCount` option and
  default it to false for non-pagination callers. Parallelize independent mobile
  dashboard queries immediately, then benchmark a single backend-agnostic web
  dashboard bootstrap service returning only role-relevant fields. Preserve
  direct Supabase RLS semantics and do not send admin datasets to ordinary users.
- **6. Expected benefit:** mobile dashboard removes one serialized wait and two
  count scans; native web startup can reduce authenticated requests from roughly
  6-8 to 1-2.
- **7. Implementation complexity:** Medium.
- **8. Risk:** Medium; aggregated payloads can over-fetch, weaken authorization,
  or make independent panel failures all-or-nothing.
- **9. Dependencies:** repository contract, both adapters, dashboard services,
  role tests, and payload DTOs.
- **10. How to benchmark before and after:** record request waterfall, DB statement count, payload bytes,
  and P95 time-to-dashboard for every role/backend. Ship consolidation only if
  it improves P95 without increasing bytes or authorization exposure.

### F06 — Move scalable web reporting and export work to existing server aggregates

- **Priority / class:** P1; Architectural improvement and Database optimization.
- **1. Current behavior:** the reports page stores timesheet pages in browser
  memory and computes filters/summaries/comparisons/missing days locally. Export
  fetches every remaining page sequentially and repeatedly copies the growing
  array. The API already exposes SQL-grouped totals.
- **2. Evidence:** `app/reports/page.tsx:128-218,196-213,319-367`,
  `lib/api/v1/services/reports.ts:40-48`, and
  `lib/db/native.ts:1103-1143`.
- **3. Performance impact:** client CPU/memory and network scale with total
  visible history; sequential export latency scales with page count; summaries
  can reflect only loaded rows before all pages are fetched.
- **4. Root cause:** web reports predate or do not consume the grouped-report
  service and server-side export path.
- **5. Recommended optimization:** reuse a backend-agnostic report service for
  web summary/comparison tabs, push date/user/project filters to SQL, and expose
  a bounded/streamed CSV export that does not hydrate the entire dataset into
  React state. Keep small “my hours” tables paginated and client-interactive.
- **6. Expected benefit:** bounded browser memory, fewer transferred rows, faster
  aggregate views, and export latency based on server throughput rather than
  serial browser round trips.
- **7. Implementation complexity:** High.
- **8. Risk:** High; report semantics, RLS/team scope, timezone/date behavior,
  and CSV output must remain identical across backends.
- **9. Dependencies:** report DTO/API contract, repository aggregate methods,
  CSV behavior tests, download response limits, and access-control tests.
- **10. How to benchmark before and after:** compare 10k/100k/1m-row datasets for response bytes, browser
  heap, long tasks, time-to-summary, export duration, and output checksum. Server
  output must match current fixtures exactly.

### F07 — Replace mobile bulk mutation loops with bounded batch APIs

- **Priority / class:** P1; Architectural improvement; Refactor.
- **1. Current behavior:** bulk delete and duplicate loop sequentially over IDs.
  Each `SessionProvider` mutation then reloads the dashboard, so N selected rows
  can produce approximately 2N authenticated requests plus repeated dashboard
  queries.
- **2. Evidence:** `mobile/src/screens/TimesheetListScreen.tsx:213-279` and
  `mobile/src/auth/SessionProvider.tsx:402-499`.
- **3. Performance impact:** high latency, radio/network overhead, repeated auth
  lookups and database work, unnecessary dashboard state churn, and poor offline
  sync throughput.
- **4. Root cause:** single-item APIs were composed in the UI without a batch
  orchestration boundary; cache refresh is embedded in every mutation method.
- **5. Recommended optimization:** add size-limited batch delete/duplicate
  service operations with per-row results and one rate-limit charge consistent
  with existing bulk-edit semantics. Decouple mutation from dashboard refresh;
  apply returned rows/counts locally and refresh once after a batch or sync flush.
- **6. Expected benefit:** O(N) network/auth refreshes become O(1) or bounded
  chunks, with one dashboard refresh.
- **7. Implementation complexity:** Medium-High.
- **8. Risk:** High; partial failure, daily-hour caps, authorization, idempotency,
  offline ordering, and rate-limit semantics need explicit contracts.
- **9. Dependencies:** versioned API additions, repository batch methods, sync
  queue format/versioning, and mobile UX for partial failures.
- **10. How to benchmark before and after:** execute 1/10/100-row batches and measure request count,
  statements, bytes, wall time, and UI commits. Ten rows should require one batch
  request and at most one refresh, with identical per-row outcomes.

### F08 — Eliminate N+1 validation and update queries in bulk edit

- **Priority / class:** P1; Database optimization; Refactor.
- **1. Current behavior:** `bulkUpdateTimesheets` validates each row with
  sequential `getTimesheet`, sometimes `getBackfillWindow`, and
  `sumHoursForUserDate` calls. Native and Supabase adapters then update rows one
  at a time.
- **2. Evidence:** `app/actions/timesheets.ts:296-348`,
  `lib/db/native.ts:853-886`, and `lib/db/supabase.ts:745-786`.
- **3. Performance impact:** statement/round-trip count grows by roughly 3N-4N;
  native holds a transaction across N awaits; Supabase incurs N PostgREST calls.
- **4. Root cause:** per-row business validation was reused instead of designing
  a set-based repository operation.
- **5. Recommended optimization:** fetch owners/current rows once, fetch settings
  once, compute daily proposed totals as a set, and apply updates through a
  set-based SQL/RPC operation with per-row results. Keep final authorization and
  24-hour enforcement inside the transaction/database boundary to prevent races.
- **6. Expected benefit:** bounded round trips, shorter transactions, lower lock
  time, and substantially higher batch throughput.
- **7. Implementation complexity:** High.
- **8. Risk:** High; partial-success semantics and concurrent daily totals are
  correctness-sensitive.
- **9. Dependencies:** dual migrations/RPC where required, repository interface,
  action tests, concurrency tests, and Supabase grant/RLS tests.
- **10. How to benchmark before and after:** compare 1/50/500 rows, capturing statements, transaction
  duration, locks, P95, and result parity under concurrent edits. Statement count
  should be O(1) per bounded batch, not O(N).

### F09 — Batch backup restore and bound transaction/memory scope

- **Priority / class:** P1; Database optimization and Architectural improvement.
- **1. Current behavior:** restore loads all existing timesheet keys/totals into
  memory and inserts projects, activity types, timesheets, leaves, reminders,
  and global reminders one row at a time. Native keeps one transaction open;
  Supabase has no equivalent all-or-nothing transaction.
- **2. Evidence:** `lib/db/native.ts:953-1075` and
  `lib/db/supabase.ts:869-1019`.
- **3. Performance impact:** O(database size + backup size) memory, O(N) round
  trips, long-held locks/native transaction, timeouts, and poor behavior for
  large backups.
- **4. Root cause:** restore prioritizes simple idempotency checks over staging,
  batch insertion, and bounded processing.
- **5. Recommended optimization:** benchmark realistic backup sizes; process in
  validated chunks, batch inserts/upserts, and move duplicate/daily-total checks
  into set-based SQL. For truly large restores, use a staging-table/RPC/COPY
  design only if chunking misses the target. Define backend-equivalent atomicity
  and resumability before implementation.
- **6. Expected benefit:** fewer round trips, bounded memory, shorter lock windows,
  and recoverable large restores.
- **7. Implementation complexity:** High.
- **8. Risk:** High; restore is destructive/administrative and partial commits
  can create backend divergence.
- **9. Dependencies:** backup format/version, dual-backend transaction strategy,
  migration permissions, size limits, and restore integration fixtures.
- **10. How to benchmark before and after:** 1k/10k/100k-row backups; measure peak RSS, statements,
  transaction age, locks, duration, and restored checksum/idempotent rerun.

### F10 — Combine mobile session and actor authorization lookups

- **Priority / class:** P1; Database optimization; Refactor.
- **1. Current behavior:** every protected v1 request verifies JWT, then queries
  the session by ID, then queries the profile by user ID before route work.
- **2. Evidence:** `app/api/v1/_http.ts:34-58`,
  `lib/auth/mobile-session-store.ts:154-156,296-303`, and
  `lib/auth/mobile-actor.ts:29-53`.
- **3. Performance impact:** two serialized DB/PostgREST round trips are paid by
  every mobile read and mutation, amplifying all list and bulk workloads.
- **4. Root cause:** session storage and actor loading are separate abstractions.
- **5. Recommended optimization:** add a repository/auth-store operation that
  resolves active session plus minimal actor projection in one native join and
  one security-reviewed Supabase RPC/query. Do not cache revocation or
  `is_active` across requests unless a measured need and explicit invalidation
  model justify it.
- **6. Expected benefit:** one fewer database/network round trip per protected
  mobile request with current revocation behavior preserved.
- **7. Implementation complexity:** Medium.
- **8. Risk:** High; auth correctness and service-role/RLS boundaries are
  security-critical.
- **9. Dependencies:** session schema, Supabase RPC grants, auth tests for
  revoked/rotated/expired/inactive sessions, and query plan evidence.
- **10. How to benchmark before and after:** compare auth-gate P50/P95 and statement count at 1/50/200
  concurrent requests. All rejection matrices must remain identical.

### F11 — Make connection/rate-limit behavior safe for horizontal scaling

- **Priority / class:** P1; Infrastructure/configuration improvement and
  Architectural improvement.
- **1. Current behavior:** native pool max is hard-coded to 10 per process;
  deployment has one replica and no autoscaling/disruption budget; rate limits
  are process-local maps.
- **2. Evidence:** `lib/db/pool.ts:25-32`, `deploy/deployment.yaml:10-56`, and
  `lib/rate-limit.ts:18-44`.
- **3. Performance impact:** adding replicas multiplies possible DB connections
  and makes limits inconsistent; one replica limits availability and throughput;
  pool waits and database capacity are unobserved.
- **4. Root cause:** single-instance assumptions are not encoded as explicit
  limits or a distributed state design.
- **5. Recommended optimization:** calculate a total connection budget from DB
  capacity and replica count; make pool max/timeouts configurable and consider
  PgBouncer/managed pooling for scaled native deployments. Move security-critical
  limits to an atomic shared store or PostgreSQL only when scaling beyond one
  process. Add HPA/PDB/multiple replicas only after load tests and state review.
- **6. Expected benefit:** predictable database load, consistent limits, and a
  safe path to higher availability/throughput.
- **7. Implementation complexity:** High.
- **8. Risk:** High; premature autoscaling can worsen DB saturation and break
  rate-limit guarantees.
- **9. Dependencies:** production DB `max_connections`, pooler availability,
  expected replicas, traffic model, and operations ownership.
- **10. How to benchmark before and after:** load-test 1/2/3 replicas while measuring pool wait,
  connections, DB CPU, P95/P99, and cross-replica rate-limit correctness. Do not
  enable HPA until the total connection invariant is proven.

### F12 — Split mobile session context by update frequency

- **Priority / class:** P2; Refactor.
- **1. Current behavior:** one context value contains status, actor, dashboard,
  reference data, reminders, sync flags, counters, and more than 25 callbacks.
  Any changed value invalidates all 14+ consumers.
- **2. Evidence:** `mobile/src/auth/SessionProvider.tsx:105-139,863-956` and
  `useSession` call sites across `mobile/App.tsx` and `mobile/src/screens/*`.
- **3. Performance impact:** unrelated screens/components can re-render on
  pending-count, syncing, dashboard, reference, or error changes.
- **4. Root cause:** authentication, cached data, network services, and sync state
  share one provider for convenience.
- **5. Recommended optimization:** first profile commits. If fan-out is material,
  split stable command/API services from auth state and high-frequency sync/data
  state, or introduce narrowly selected hooks. Preserve one session controller
  and avoid a new state library unless built-in contexts cannot meet measured
  targets.
- **6. Expected benefit:** fewer and shorter React commits during sync/network
  changes.
- **7. Implementation complexity:** Medium.
- **8. Risk:** Medium; provider splits can create stale closures or inconsistent
  snapshots.
- **9. Dependencies:** React Profiler traces and existing SessionProvider tests.
- **10. How to benchmark before and after:** compare commit count/duration for queue flush, dashboard
  refresh, and pending-count update. Ship only if affected screens show a clear
  reduction with no state-consistency failures.

### F13 — Add explicit reference-data cache semantics and request deduplication

- **Priority / class:** P2; Architectural improvement; Quick win for in-flight
  dedupe.
- **1. Current behavior:** mobile `loadReference` always fetches projects,
  activity types, and titles; Profile and TimeEntryForm can trigger it. API GET
  responses generally have no ETag or cache headers. Web native deduplicates only
  concurrent identical requests; Supabase reads are separate.
- **2. Evidence:** `mobile/src/auth/SessionProvider.tsx:347-371`,
  `mobile/src/screens/ProfileScreen.tsx:46-48`,
  `mobile/src/components/TimeEntryForm.tsx`, `lib/data/client.ts:223-249`, and
  only `app/api/v1/config/route.ts:25-27` defines cache control.
- **3. Performance impact:** repeated low-churn reference payloads consume mobile
  radio, auth, API, and DB resources.
- **4. Root cause:** dashboard has a cache, but reference data lacks TTL/version/
  invalidation and single-flight behavior.
- **5. Recommended optimization:** add mobile in-flight dedupe plus actor/server-
  scoped TTL storage for reference DTOs, then conditional GET with ETag/version
  if measurements justify it. Invalidate on project/activity/title mutations;
  never shared-cache actor-scoped profile/timesheet responses.
- **6. Expected benefit:** fewer reference requests and faster form/profile open.
- **7. Implementation complexity:** Low-Medium.
- **8. Risk:** Medium; stale activity state or RLS leakage if keys/invalidation
  are wrong.
- **9. Dependencies:** mutation invalidation events, cache version, durable mobile
  storage choice, and backend parity.
- **10. How to benchmark before and after:** count requests/bytes across app start plus repeated form/
  profile opens; verify 304/cache hits and immediate invalidation after mutation.

### F14 — Tune PostgreSQL indexes, projections, RLS, and counts from plans

- **Priority / class:** P2 overall; Database optimization. Promote individual
  items to P1 only when `EXPLAIN`/statistics demonstrate impact.
- **1. Current behavior:** many Supabase paths use `select('*')`; timesheet
  pagination/order/filter patterns vary; project/date filtering lacks a matching
  composite index; titles/domains have both a UNIQUE index and an explicit index
  on the same column; RLS policies call auth/helper functions in row predicates;
  session cleanup filters expiry/revocation columns not led by current indexes.
- **2. Evidence:** `lib/db/supabase.ts:79-108,183-185,351-368,1138-1183`,
  `lib/db/native.ts:340-397,1103-1143`,
  `db/migrations/0008_perf_indexes.sql`,
  `db/migrations/0013_whitelisted_domains.sql`,
  `db/migrations/0014_titles.sql`, `db/migrations/0017_mobile_sessions.sql`, and
  current Supabase policies in `supabase/migrations/*`.
- **3. Performance impact:** possible excess payload/serialization, deep offset
  scans, avoidable index write/storage cost, selective report scans, per-row RLS
  helper work, and cleanup scans as data grows.
- **4. Root cause:** schema evolved incrementally without committed production
  plan/statistics evidence or an index-usage review.
- **5. Recommended optimization:** inventory effective indexes/policies on a
  migrated database; run representative plans; project only fields used by each
  DTO; remove proven duplicate/unused indexes in forward migrations; evaluate
  `(project_id, log_date, id)` and cleanup indexes; wrap stable auth expressions
  in init-plan-friendly subselects only where plans prove repeated execution.
  Never add every candidate index.
- **6. Expected benefit:** smaller responses and faster selective queries with
  lower write/storage overhead from removing redundancy.
- **7. Implementation complexity:** Medium-High.
- **8. Risk:** High; index removal or RLS rewrites can regress constraints,
  authorization, writes, or Supabase behavior.
- **9. Dependencies:** production-like statistics/cardinality, dual forward
  migrations, `pg_stat_user_indexes`, Supabase migration tests, and rollback/
  forward-fix SQL.
- **10. How to benchmark before and after:** compare plans/buffers/timing plus insert/update throughput
  before and after. Accept an index only when target plans improve without an
  unacceptable write/storage regression; prove dropped indexes do not enforce a
  constraint.

### F15 — Reduce web Client Component and optional-panel cost selectively

- **Priority / class:** P2; Refactor.
- **1. Current behavior:** all UI routes are top-level Client Components;
  dashboard statically imports every user/admin panel and constructs registries
  in its parent; reports is an 848-line client page. Suspense exists mainly to
  satisfy `useSearchParams` and uses `fallback={null}`.
- **2. Evidence:** `'use client'` in `app/page.tsx`,
  `app/dashboard/page.tsx`, `app/reports/page.tsx`; static panel imports at
  `app/dashboard/page.tsx:16-34`; registries at `308-396`; Suspense at
  `572-576`; production build confirms static shells.
- **3. Performance impact:** large hydration boundaries and optional admin code
  in the dashboard route; potential parent-driven re-renders; blank Suspense
  fallback. No evidence currently proves a full RSC rewrite is faster.
- **4. Root cause:** browser auth/state and many interactive panels were composed
  at page level.
- **5. Recommended optimization:** first dynamically import heavy role/tab-only
  panels and measure. Extract stable/memoized subtrees only where profiler traces
  show repeated expensive commits. Consider a Server Component shell/bootstrap
  tracer bullet for one route only after F05, preserving static rendering and
  minimizing serialized props. Replace null Suspense fallbacks with meaningful
  skeletons; do not force static data caching for authenticated content.
- **6. Expected benefit:** smaller initial dashboard JS and improved perceived
  loading; potential reduction in render work.
- **7. Implementation complexity:** Medium for dynamic panels; High for RSC
  restructuring.
- **8. Risk:** Medium-High; role-gated chunks can flash, fail offline, or create
  new server/client serialization and auth duplication.
- **9. Dependencies:** bundle analyzer, React profiles, Next.js 16 RSC/Suspense
  docs, role tests, and F04/F05 outcomes.
- **10. How to benchmark before and after:** route JS/Brotli, hydration, LCP/INP, long tasks, and React
  commits by role. Keep static route classification unless a measured tradeoff
  is approved.

### F16 — Make mobile storage and startup work non-blocking and durable

- **Priority / class:** P2; Architectural improvement.
- **1. Current behavior:** boot reads workspace storage, fetches config, reads
  refresh tokens, rotates them, writes tokens, and fetches actor sequentially.
  Windows fallback storage uses synchronous filesystem APIs; dashboard cache is
  process-memory only; offline queue persistence depends on `localStorage`, which
  React Native does not guarantee.
- **2. Evidence:** `mobile/src/auth/SessionProvider.tsx:836-861`,
  `mobile/src/auth/session-controller.ts:31-56,139-145`,
  `mobile/src/platform/secure-storage/durable.ts:53-155`,
  `mobile/src/storage/dashboard-cache.ts:17-62`, and
  `mobile/src/storage/offline-queue.ts:93-138`.
- **3. Performance impact:** synchronous file work can block the JS thread;
  sequential boot delays interactivity; non-durable caches/queues reduce the
  effectiveness of local caching and can repeat network work after restart.
- **4. Root cause:** cross-platform fallbacks were implemented without
  platform-native async storage and a persisted, versioned cache abstraction.
- **5. Recommended optimization:** profile each startup stage; use installed
  platform-native secure/async storage adapters, persist only bounded/versioned
  non-sensitive dashboard/reference data, and render safe cached UI while token
  refresh proceeds where security semantics allow. Batch queue persistence and
  keep ordered mutation replay.
- **6. Expected benefit:** lower cold-start blocking, durable offline behavior,
  fewer post-restart requests, and bounded cache memory.
- **7. Implementation complexity:** High across three platforms.
- **8. Risk:** High; token storage security, stale identity, migrations, and
  Windows support are release blockers.
- **9. Dependencies:** platform storage modules/toolchains, secure-storage spike,
  installed-device tests, cache schema/versioning, and privacy review.
- **10. How to benchmark before and after:** cold/warm start stage timings, JS long tasks, disk I/O,
  restart/offline behavior, queue durability, and memory on Android/iOS/Windows.

### F17 — Preserve current list/image/animation behavior unless profiling fails

- **Priority / class:** P3; Quick win; measurement gate only.
- **1. Current behavior:** data-heavy mobile screens already use `FlatList` with
  stable callbacks, bounded render windows, clipping where supported, and
  memoized entry cards. Current source has no runtime image components/assets.
  Existing animations use transform/opacity and native-driver-compatible
  primitives. Metro enables `inlineRequires`.
- **2. Evidence:** `mobile/src/screens/TimesheetListScreen.tsx:281-496`, similar
  FlatList settings in Leaves/Reminders/Reports/Team, memoized
  `mobile/src/components/TimesheetEntryCard.tsx`,
  `mobile/src/components/Toast.tsx`, `mobile/src/components/PressableScale.tsx`,
  and `mobile/metro.config.js`.
- **3. Performance impact:** no demonstrated bottleneck. Replacing FlatList with
  FlashList/LegendList or adding an image cache would add dependencies and
  platform risk without evidence.
- **4. Root cause:** not applicable; this finding prevents premature work.
- **5. Recommended optimization:** profile scroll FPS, mount time, memory, item
  height variance, and transition frames. Tune FlatList or adopt another
  virtualizer only if a named screen misses its budget. Add image caching only
  when product code adds remote images. Keep transform/opacity animations.
- **6. Expected benefit:** avoids unnecessary dependencies and focuses effort on
  measured hotspots.
- **7. Implementation complexity:** Low to measure; Medium-High if replacement is
  justified.
- **8. Risk:** Low for measurement, Medium for list/navigation replacement.
- **9. Dependencies:** release-device traces and Windows compatibility.
- **10. How to benchmark before and after:** 100/1,000-item scroll traces, dropped frames, mount time,
  peak memory, and transition duration before selecting any library.

### F18 — Reduce CI duplication and add missing mobile/performance gates

- **Priority / class:** P2; Infrastructure/configuration improvement.
- **1. Current behavior:** separate jobs each run `npm ci`; native Next.js build
  is repeated in the matrix, E2E job, and Docker build. Root CI has no mobile
  lint/typecheck/Jest job and no bundle/load regression gate.
- **2. Evidence:** `.github/workflows/ci.yml:8-114`; no mobile references in
  `.github/workflows`; mobile scripts exist in `mobile/package.json`.
- **3. Performance impact:** duplicated runner CPU/network/time and no automated
  protection against mobile regressions or bundle growth.
- **4. Root cause:** jobs optimize for isolation/parallelism, but artifacts and
  mobile workflows were not added.
- **5. Recommended optimization:** measure critical path and billed minutes;
  keep parallelism where it shortens feedback, reuse a verified native build
  artifact for Playwright when environment equivalence is proven, enable Docker
  layer cache, and add mobile lint/typecheck/Jest. Add bundle budgets after three
  stable baseline runs; run k6 on scheduled/release infrastructure, not every PR,
  unless cost is acceptable.
- **6. Expected benefit:** lower CI compute cost and stronger regression coverage.
- **7. Implementation complexity:** Medium.
- **8. Risk:** Medium; over-sharing artifacts can hide backend/env differences,
  and combining jobs can lengthen feedback.
- **9. Dependencies:** GitHub cache/artifact policy, secret availability, runner
  minutes, and reproducible build environment.
- **10. How to benchmark before and after:** compare median/p95 workflow wall time, billed minutes,
  install/build cache hit rate, and failure-detection time over at least 10 runs.

## Next.js / React Optimization

1. Implement F04 and F05 before broad RSC changes; they directly remove measured
   bundle/round-trip work while preserving current architecture.
2. Use Next.js 16 analyzer output to split role/tab-only dashboard panels. Start
   with the largest optional client panels (`super-admin-panel.tsx`, backup,
   import, hierarchy) and preserve preload-on-intent where it improves perceived
   latency.
3. Treat the current static route classification as a benefit. Authenticated
   content is dynamic in the browser, but static shells deploy cheaply. A Server
   Component migration must demonstrate lower LCP/JS without worse TTFB, cache
   leakage, or duplicate auth work.
4. Keep `useSearchParams` inside Suspense, but replace null fallbacks. Suspense
   will not stream the current client-side `useEffect` fetches; streaming requires
   server data boundaries or a client cache with suspense support.
5. Use React Profiler before memoizing. The dashboard parent and large reports
   page are candidates, but trivial memoization and unstable props can make code
   worse without reducing commits.
6. Continue using `next/font/local`; no image optimization work is currently
   required because application UI does not render content images. Remove unused
   starter public assets only as separate cleanup, not as a performance phase.
7. Server Actions already authenticate and return error shapes. Benchmark the
   synchronous `safeAudit` round trip (`app/actions/_shared.ts:63-80`) before
   considering `after()` or transaction integration; audit durability rules
   decide whether response-path deferral is acceptable.

## React Native Optimization

1. Fix F03 first; it is a functional pagination defect and a direct waste source.
2. Implement F07 only with a versioned batch contract, partial-result semantics,
   bounded batch size, and offline queue migration.
3. Profile provider fan-out before F12. Keep one controller; split subscription
   surfaces, not business ownership.
4. Measure boot stages independently: workspace read, config request, token read,
   refresh, token write, actor request, dashboard request, and first interactive
   frame. F10 and F16 should remove the dominant stages in evidence order.
5. Keep existing FlatList/memo/animation behavior unless release traces fail.
   The absence of images means `expo-image`/image caching is out of scope today.
6. Evaluate native-stack/native-tab navigation only after transition profiles
   and Windows support are verified. The custom reducer currently mounts one
   screen and has no demonstrated navigation bottleneck.
7. Track bundle raw/gzip size and module composition per platform. The Android
   1,182.7/288.7 KB reference is a baseline, not an arbitrary pass/fail budget.

## PostgreSQL Optimization

1. Enable/query `pg_stat_statements` where permitted and capture plans with
   production-like cardinality before adding indexes.
2. Prioritize F05, F08, F09, and F10 because they remove whole statements and
   round trips. Set-based work generally dominates micro-tuning.
3. Evaluate indexes for the actual predicates and order: user/date/keyset,
   project/date reports, and session cleanup. Check write amplification and size.
4. Remove redundant `idx_whitelisted_domains_domain` and `idx_titles_name` only
   after verifying the unique constraints created equivalent indexes in both
   migrated schemas and no name-dependent tooling relies on them.
5. Review effective Supabase policies, not historical migration text. Benchmark
   `(select auth.uid())`/helper init-plan forms and `team_ids` under realistic
   team sizes; preserve security-definer guards, grants, and RLS parity.
6. Configure pool connect/idle/statement timeouts and expose pool wait/error
   metrics. Size app pool plus pooler against database capacity, not a universal
   formula.
7. Monitor vacuum/analyze and dead tuples after bulk/restore changes. Tune
   autovacuum only when high-churn tables show stale statistics or bloat.

## API / Network Optimization

- Repair the current numeric range pagination (F03). Evaluate a stable cursor
  only under F14 if representative deep-offset plans miss an approved target.
- Add role-minimal dashboard bootstrap and optional counts (F05).
- Move aggregate/export work server-side (F06).
- Add bounded batch mutation APIs and one refresh (F07).
- Combine mobile auth lookups (F10).
- Add response-size instrumentation and DTO projections. Replace `select('*')`
  only where consumer field analysis proves columns are unused.
- Keep v1 error responses small and generic. Add internal request IDs and logs;
  do not serialize stack traces or duplicate full errors to clients.
- Enable compression at the hosting/ingress layer and verify it with actual
  response headers; do not assume Next.js/Vercel and self-hosted ingress behave
  identically.

## Caching Strategy

Use the smallest cache that has demonstrated reuse and an invalidation owner:

| Data | Recommended cache | Scope/key | Invalidation |
| --- | --- | --- | --- |
| Static JS/fonts | Existing Next/CDN immutable cache | content hash | deployment |
| Mobile config | short TTL/conditional GET after measurement | server origin + API version | deployment/config change |
| Projects/activity types/titles | F13 TTL + ETag/version | server + actor/role + schema version | related mutation |
| Dashboard | existing mobile cache, made durable only via F16 | server + actor + version | timesheet/profile mutation, TTL, logout |
| Timesheets/reports | no shared result cache initially | actor + complete filters | mutations make invalidation expensive |
| Actor/session authorization | combine lookup, do not cross-request cache first | session ID/user ID | immediate revoke/status/role changes |
| Server request dedupe | React `cache` only when one request repeats a pure read | request-local | request end |

Do not enable global Next cache for authenticated RLS data without proving the
cache key includes identity and authorization state. Multi-instance Next cache
coordination is unnecessary while all UI routes are static and data caches are
not used; revisit only if ISR/Cache Components are introduced.

## Observability and Profiling

- Define initial service objectives from current k6 floor and product needs:
  availability/error rate, dashboard/report P95, mobile cold start, and sync
  completion. The existing `<2s P95`/`<1%` error threshold is a starting floor,
  not a complete SLO.
- Attach request ID, route template, backend mode, status, duration bucket,
  response bytes, DB statement count/time, and pool wait to server telemetry.
- Record Web Vitals by route/backend/device class and alert on sustained releases,
  not single-user noise.
- Record release-only mobile startup, screen transition, network, sync, crash,
  and ANR/hang metrics with sampling and privacy controls.
- Dashboard PostgreSQL: connections, active/idle/waiting, query P95, slow plans,
  lock waits, dead tuples, autovacuum/analyze, cache hit ratio, and DB CPU/memory.
- Create runbooks for DB saturation, elevated auth latency, failed restore,
  mobile sync backlog, and bundle/CI regression.

## Build / CI Optimization

1. Add mobile lint, typecheck, and Jest as required gates before mobile
   performance work.
2. Capture Next analyzer and mobile bundle reports as CI artifacts; establish
   budgets from three stable builds and approved feature headroom.
3. Cache npm downloads (already configured), Next/Turbopack cache, Gradle,
   CocoaPods, and Docker layers where reproducibility is preserved.
4. Reuse the native production build for Playwright only after proving its env
   and artifact match the E2E job. Never reuse Supabase output for native tests.
5. Add scheduled/release k6 matrices for native and Supabase, plus mobile v1
   dashboard/timesheets/auth flows. Keep PR smoke workloads short.
6. Track CI compute minutes as an efficiency metric; optimize total cost and time
   to trustworthy feedback, not just one job's duration.

## Prioritized Recommendations

| Rank | ID | Priority | Classification | First measurable outcome |
| ---: | --- | --- | --- | --- |
| 1 | F01 | P0 | Infrastructure/config | route/query/mobile baselines exist |
| 2 | F02 | P0 | Quick win / infrastructure | probes stop creating pools/restart loops |
| 3 | F03 | P0 | Quick win | mobile page two advances correctly |
| 4 | F05 | P1 | Architecture / DB | fewer dashboard requests/counts |
| 5 | F07 | P1 | Architecture / network | bulk request count becomes bounded |
| 6 | F08 | P1 | Database optimization | bulk edit statements become bounded |
| 7 | F10 | P1 | Database optimization | one auth DB round trip/request |
| 8 | F04 | P1 | Refactor | inactive backend/Zod absent from client graph |
| 9 | F06 | P1 | Architecture / DB | reports use bounded client memory |
| 10 | F09 | P1 | Database optimization | restore is chunked/set-based |
| 11 | F11 | P1 | Infrastructure/config | replica/pool/limit invariant proven |
| 12 | F13 | P2 | Architecture / quick win | reference cache hits reduce requests |
| 13 | F12 | P2 | Refactor | measured context render fan-out falls |
| 14 | F14 | P2 | Database optimization | plan-backed index/projection changes only |
| 15 | F15 | P2 | Refactor | optional panel JS/hydration falls |
| 16 | F16 | P2 | Architecture | startup/storage no longer blocks/fails durability |
| 17 | F18 | P2 | Infrastructure/config | mobile gates added; CI minutes reduced |
| 18 | F17 | P3 | Quick win / measurement gate | no change unless profiler budget fails |

## Execution Slices

Each slice is independently reviewable and reversible. The “targeted proof” is
the minimum verification, not permission to skip broader checks listed in
`## Final Verification` when a slice is released.

| Slice | Findings / scope | Depends on | Deliverable and targeted proof |
| --- | --- | --- | --- |
| S0a | F01 existing-tool baseline | None | No production-code change. Retain web/API/mobile/DB/CI artifacts with commit/environment metadata using existing builds, analyzers, k6, browser/platform profilers, and safe SQL observations. Record unavailable environments explicitly. |
| S0b | F01 instrumentation tracer | S0a artifact format | Instrument one protected v1 route and its DB/service work with dependency-free correlation/timing, then compare enabled/disabled overhead. Run `npx vitest run tests/logger.test.ts tests/mobile-request-auth.test.ts` and the representative load workload. Expand only after the tracer passes. |
| S1 | F02 health/probes | S0a baseline format | Separate process liveness and bounded dependency readiness; update deployment/Docker probes. Add `tests/health-route.test.ts`; run it plus a probe soak and simulated DB outage. |
| S2 | F03 range contract | None; may run beside S1 | Numeric mobile `from/to`, exact inclusive range serialization, and page-two UI behavior with no server contract change. Run `npx jest --runInBand __tests__/api-client.test.ts __tests__/timesheet-list-screen.test.tsx` from `mobile`, plus `npx vitest run tests/mobile-timesheets-route.test.ts`. |
| S3a | F05 count and mobile parallelism tracer | S0b | Add `includeCount` parity, disable counts only for proven non-pagination callers, then parallelize the two mobile dashboard reads. Run dashboard/repository/data-client tests and compare request/statement counts. |
| S3b | F05 web bootstrap tracer | S3a | Implement one role-minimal web bootstrap path behind the existing behavior or an existing flag mechanism; prove all role/backend payloads before migration. Run action/API/backend parity tests and Playwright dashboard flows. |
| S4 | F10 combined auth lookup | S0b | One fail-closed session+actor lookup per protected request in both backends. Run `npx vitest run tests/mobile-request-auth.test.ts tests/mobile-session-store.test.ts tests/mobile-me-route.test.ts` and the full rejection matrix. |
| S5a | F07 one batch tracer | S2, S4 recommended | Implement only batch delete first, with bounded input, ordered per-item results, one refresh, and backward-compatible single-item fallback. Run new route/service tests plus mobile list/session/sync tests. |
| S5b | F07 remaining justified batches | S5a benchmark passes | Apply the proven contract to duplicate and offline flush only where request/latency evidence warrants it. Preserve queue ordering and migration compatibility. |
| S6 | F08 set-based bulk edit | S0b; A11 not required | Preserve current per-row outcomes while bounding action/repository round trips and transaction duration. Run `tests/actions.test.ts`, `tests/native-repository.test.ts`, `tests/supabase-migrations.test.ts`, and `tests/daily-hours-concurrency.int.test.ts` when `TEST_DATABASE_URL` is available. |
| S7a | F04 client dependency split | S0a bundle artifact | Remove inactive backend and client Zod from measured graphs without changing public client interfaces. Run data/auth/validation tests, both backend builds, analyzer comparison, and auth/data E2E. |
| S7b | F15 one optional panel | S7a | Dynamically load only the largest measured role/tab-only panel. Expand no further unless route JS and user-visible metrics improve. |
| S8 | F06 one report tracer, then export | S0b | Move one summary to existing aggregate service, prove fixture/role/backend parity, then add bounded export only if the tracer passes. Run `tests/reports.test.ts`, `tests/reports-route.test.ts`, `tests/mobile-reports-route.test.ts`, and `tests/csv.test.ts`. |
| S9a | F14 plan-backed DB tuning | S0a/S0b and A07 | One query/index/projection/RLS change per forward migration, each with before/after plan and write/storage evidence. Run migration guards and affected repository/authorization tests. |
| S9b | F09 restore scaling | S0a/S0b, A07, A11 resolved before semantics change | First preserve semantics with bounded batching/set-based work; introduce staging/COPY or altered atomicity only if separately approved. Run backup/restore, Supabase restore, migration, checksum, idempotency, and interruption tests. |
| S9c | F11 capacity controls | S0b and A09 | Add configurable pool timeouts/metrics first. Treat pooler, shared limiter, replicas, PDB, and HPA as separate operational changes after capacity proof. |
| S10a | F13 cache semantics | S0b, S4 | In-flight dedupe first; TTL/ETag/durable storage only if repeated calls remain material. Run cache, isolation, mutation invalidation, logout, and offline tests. |
| S10b | F12 provider subscription fan-out | S0a mobile profile | Profile commits first, then make one subscription/context change if a named interaction misses its budget. Run session-provider and affected screen tests plus before/after React profiles. |
| S10c | F16 storage/startup tracer | S0a, A12 | Spike one platform-native storage path, prove security/durability/startup behavior, then expand platform-by-platform. Run storage, queue, sync, session, installed release, memory, and startup checks for each affected platform. |
| S11 | F18 and production rollout | Accepted prior slices | Add mobile gates and benchmark artifacts, then optimize only measured CI duplication. Run the complete root/mobile/dual-backend verification and staged rollout/rollback drills. |

## Implementation Phases

### Phase 0 — Baseline and safety rails

- Run S0a to capture existing-tool baselines before production-code changes,
  then prove the S0b single-route timing/correlation tracer and its overhead.
- Expand instrumentation only to the next boundary needed by a scheduled slice;
  do not build a horizontal telemetry platform in Phase 0.
- Add test datasets and benchmark scripts without adding a new benchmark
  framework where k6, Playwright, Jest/Vitest, psql, and platform profilers suffice.
- Approve SLOs, data-retention rules, and per-phase regression budgets.
- **Exit gate:** every P0/P1 item has a reproducible before measurement or an
  explicitly named unavailable environment; no optimization is accepted on
  intuition alone.

### Phase 1 — Critical correctness and probe resources

- Deliver F03's mobile contract/client/screen repair as the tracer bullet. Add
  regression tests and verify the existing v1 route/repository semantics remain
  unchanged.
- Deliver F02 with separate liveness/readiness and shared/bounded DB access.
- **Exit gate:** mobile paging advances through seeded pages; probe soak creates
  no per-probe pools and DB outage does not cause liveness restart churn.

### Phase 2 — Round trips and batching

- Add `includeCount`, parallel mobile dashboard reads, and one role-safe web
  bootstrap tracer (F05).
- Implement combined auth lookup (F10).
- Implement one bounded mobile bulk flow end-to-end before generalizing (F07).
- Redesign bulk edit set-wise (F08).
- **Exit gate:** statement/request counts meet the acceptance criteria and dual
  backend authorization/concurrency tests pass.

### Phase 3 — Bundle and reporting architecture

- Remove inactive backend and client Zod imports (F04).
- Dynamically split one largest optional admin panel and measure before expanding
  (F15).
- Move one report summary to existing SQL aggregation, prove parity, then migrate
  remaining aggregate/export paths (F06).
- **Exit gate:** bundle/report benchmarks improve and output/auth semantics match.

### Phase 4 — Database and restore scaling

- Capture plans/statistics and apply only proven F14 migrations.
- Implement bounded restore batches, then staging/COPY only if still required
  (F09).
- Configure pool timeouts/metrics and validate multi-replica capacity (F11).
- **Exit gate:** plans, lock duration, memory, and throughput pass at target scale;
  both migration sets and restore checksums match.

### Phase 5 — Mobile rendering, storage, and cache

- Add F13 cache semantics.
- Profile and conditionally split context (F12).
- Replace blocking/non-durable platform storage and improve startup (F16).
- Evaluate F17 navigation/list changes only if traces still miss approved budgets.
- **Exit gate:** installed release builds on Android/iOS/Windows pass startup,
  memory, offline restart, sync, and security criteria.

### Phase 6 — CI and production rollout

- Add F18 mobile/performance gates and cache/artifact improvements.
- Add runbooks, alerts, staged rollout, and rollback drills.
- Roll out one phase at a time; compare telemetry to the same pre-change cohort.
- **Exit gate:** no SLO, correctness, security, or resource regression through the
  agreed observation window.

## Files / Modules Affected

| Area | Likely files/modules |
| --- | --- |
| Baseline/telemetry | `lib/logger.ts`, `app/api/_http.ts`, `app/api/v1/_http.ts`, `lib/db/pool.ts`, `mobile/src/telemetry/telemetry.ts`, new benchmark docs/scripts |
| Health/probes | `app/api/health/route.ts`, possible new liveness route, `lib/db/pool.ts`, `deploy/deployment.yaml`, `docker-compose.yml` |
| Pagination | `mobile/src/api/contracts.ts`, `mobile/src/api/client.ts`, `mobile/src/screens/TimesheetListScreen.tsx`, `app/api/v1/timesheets/route.ts`, `lib/db/repository.ts`, both adapters, API/mobile tests |
| Web bundle/adapters | `lib/auth/client.ts`, `lib/data/client.ts`, `lib/backend/*`, `lib/validation-schemas.ts`, client password forms, `next.config.ts` only if a supported alias is required |
| Dashboard | `app/dashboard/page.tsx`, `lib/api/v1/services/dashboard.ts`, possible shared dashboard DTO/service/route, repository interface/adapters |
| Reports/export | `app/reports/page.tsx`, `lib/reports.ts`, `app/api/data/reports/route.ts`, `lib/api/v1/services/reports.ts`, repository aggregates, CSV tests |
| Mobile bulk/sync | `mobile/src/screens/TimesheetListScreen.tsx`, `mobile/src/auth/SessionProvider.tsx`, `mobile/src/api/*`, `mobile/src/storage/offline-queue.ts`, `mobile/src/sync/sync-engine.ts`, new `/api/v1/timesheets/bulk` routes/services |
| Bulk edit/restore | `app/actions/timesheets.ts`, `app/actions/import-backup.ts`, `lib/db/repository.ts`, `lib/db/native.ts`, `lib/db/supabase.ts`, dual migrations/RPCs, related tests |
| Mobile auth gate | `app/api/v1/_http.ts`, `lib/auth/mobile-session-store.ts`, `lib/auth/mobile-actor.ts`, dual session migration/RPC and tests |
| Mobile rendering/storage | `mobile/src/auth/SessionProvider.tsx`, consumers in `mobile/src/screens/*`, `mobile/src/platform/secure-storage/*`, `mobile/src/storage/*`, native configs/tests |
| Database tuning | forward files in `db/migrations/` and `supabase/migrations/`, migration guard tests, load/concurrency tests |
| Deployment/CI | `deploy/*`, `Dockerfile`, `.github/workflows/ci.yml`, `load/k6-timesheets.js`, mobile scripts only where needed |

Do not edit applied migrations. Every schema/index/RPC change requires a new
native migration and matching Supabase migration where applicable.

## Benchmarking Strategy

### Workload matrix

- Backends: native PostgreSQL container and Supabase.
- Roles: user, manager/team lead, CO, PM, admin, and super admin where relevant.
- Data: 10k/100k/1m timesheets; shallow/deep team trees; 1/10/100/500 bulk rows;
  1k/10k/100k backup rows.
- Clients: desktop/mobile browser profiles and low/mid/high Android, representative
  iOS, and Windows release builds.
- Conditions: cold/warm cache, normal/slow network, DB latency, offline/reconnect,
  single/multiple replicas.

### Comparison rules

1. Before changing a slice, record its success threshold and guardrails in the
   implementation notes. Do not choose a threshold after seeing the treatment.
2. Every artifact records commit, dirty-tree state, backend, dataset/seed or
   sanitized snapshot ID, command, tool/runtime versions, machine/device,
   release/debug mode, sample count, timestamp, and raw output location.
3. Same commit inputs except treatment, same machine/device, release builds,
   warmed and cold runs separated.
4. At least three build samples and enough request samples for meaningful P95;
   report median and variance, not one best run.
5. Record correctness checksum and authorization result with every speed metric.
6. Include CPU, RSS/heap, DB connections, query buffers, bytes, and error rate;
   latency alone can hide resource regressions.
7. If improvement is below noise or causes a material regression elsewhere,
   revert/defer it and record the result in implementation notes.
8. Run `EXPLAIN (ANALYZE, BUFFERS)` only for safe read queries on benchmark
   databases. Use `EXPLAIN` without `ANALYZE`, a rolled-back transaction, or a
   disposable database for writes and migration experiments.

### Per-slice benchmark record

Before implementation, add this record to the implementation-notes file and
fill every field; `TBD` is not an exit condition:

```text
Slice / commit / backend / dataset / environment:
Motivating metric and baseline distribution:
Pre-declared target:
Correctness, authorization, resource, and error-rate guardrails:
Exact commands and raw artifact paths:
Treatment result with variance:
Decision: accept / revise / defer / revert
```

### Existing and expanded commands

```text
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build                         # run once per backend environment
npx next experimental-analyze --output
npm run e2e                           # after matching production build
npm run a11y
npm run load                          # against seeded running target
cd mobile && npm run lint
cd mobile && npm run typecheck
cd mobile && npm test
```

Add targeted Vitest/Jest tests for each changed contract and use
`EXPLAIN (ANALYZE, BUFFERS)` only on safe benchmark databases; never run
`ANALYZE`-executing destructive statements against production.

## Acceptance Criteria

- Baseline artifacts and agreed SLOs exist before optimization work.
- Under a fixed seeded dataset, mobile range pagination returns non-overlapping
  pages, sends numeric inclusive `from/to`, and performs one list request per
  page. Cursor stability under concurrent inserts is not an F03 acceptance gate.
- Liveness performs no backend call; readiness reuses bounded DB resources;
  dependency outage does not create restart churn.
- Native web client graph contains neither Supabase nor server-side Zod; both
  backend builds and auth/data flows pass.
- Dashboard non-pagination calls execute no exact count; independent reads are
  parallel; web bootstrap request/statement count is reduced without larger
  role payloads or auth leakage.
- Bulk mobile operations use bounded request count and one refresh; bulk-edit DB
  statement count is O(1) per bounded chunk; partial results are deterministic.
- Mobile auth performs at most one backend lookup before business work and
  preserves every revocation/expiry/inactive-account case.
- Report summaries/exports match current fixture checksums and keep browser heap
  bounded as database size grows.
- Restore remains idempotent, backend-equivalent, recoverable, and within agreed
  memory/lock/time budgets.
- Every index/projection/RLS change has before/after plan evidence and no material
  write, storage, or authorization regression.
- Android/iOS/Windows release builds pass startup, frame, memory, offline restart,
  and queue durability targets.
- CI validates root and mobile code, retains performance artifacts, and improves
  billed minutes or feedback time without reducing isolation/coverage.
- Full dual-backend CI, targeted concurrency tests, Playwright, accessibility,
  load tests, and production smoke checks pass before rollout.

## Risks

- **Authorization drift:** aggregating dashboard/report/auth queries can bypass
  RLS or expose broader role data. Mitigate with backend-parity authorization
  matrices and least-field DTOs.
- **Cache staleness/leakage:** identity, role, and server must be part of every
  authenticated cache key; mutations/logout must invalidate.
- **Concurrency correctness:** batching daily-hour updates can introduce races.
  Keep final checks transactional/database-enforced and run concurrency tests.
- **Migration risk:** new/dropped indexes and RPCs can lock tables or alter plans.
  Use forward migrations, concurrent index operations where supported, staged
  rollout, and explicit forward-fix scripts.
- **Bundle selector risk:** build-time adapter splitting can break one backend or
  import server-only code. Dual-mode build/E2E is mandatory.
- **Mobile platform divergence:** native storage/navigation dependencies may not
  support Windows equally. Installed-device proof is required before rollout.
- **Observability overhead/privacy:** sample high-volume events, bound buffers,
  and redact sensitive data.
- **CI false confidence:** reused artifacts must match environment and build-time
  backend variables exactly.
- **Over-optimization:** F12-F17 are measurement-gated. A best practice alone is
  not sufficient evidence.

## Rollback Strategy

- Ship each phase independently; keep API additions backward compatible for at
  least one mobile release window.
- Use additive v1 fields/endpoints first. Mobile falls back to single-item or
  offset behavior only while the compatible server is still supported; remove
  fallback after adoption is measured.
- Keep old dashboard/report clients selectable during staged rollout if the
  deployment platform has an existing feature-flag mechanism; do not add a new
  flag service solely for this plan.
- Database changes use forward migrations. For indexes, restore the prior index
  with a new migration. For RPCs, keep the previous signature until callers are
  migrated. Never roll back by editing applied migrations.
- Cache/storage changes increment schema versions and can discard only
  reconstructible cache data. Queue/token migrations require tested backward
  compatibility and must never silently discard pending mutations or sessions.
- Container/Vercel rollback returns to the previous immutable image/deployment.
  Mobile uses staged store rollout/previous build according to platform support;
  server APIs remain backward compatible during rollback.
- Every rollout defines automatic stop conditions: sustained SLO breach,
  authorization mismatch, elevated 5xx/crash/ANR rate, DB connection/lock
  saturation, or resource growth beyond the agreed budget.

## Final Verification

1. Run `git status --short`; only planned files and the implementation-notes
   artifact may differ. Remove benchmark scratch output and generated binaries.
2. Run root lint, typecheck, unit/coverage, targeted integration/concurrency,
   both backend production builds, Playwright E2E, and accessibility tests.
3. Run mobile lint, typecheck, Jest, and release builds/tests on Android, iOS,
   and Windows for mobile-affecting phases.
4. Re-run the exact Phase 0 browser/API/mobile/PostgreSQL/CI benchmarks and attach
   raw outputs, environment, commit, and comparison tables.
5. Verify authorization parity for every role/backend, cache isolation,
   pagination stability, bulk partial failures, restore idempotency, and session
   revocation.
6. Run single- and multi-replica load/soak tests, probe-outage drills, pool
   saturation checks, and rollback drills.
7. Confirm dashboards, alerts, SLOs, and runbooks are active before production
   rollout.
8. Record the final result in
   `docs/plans/performance-efficiency-improvement-notes.md`: capability proven,
   motivating metric improved, residual bottleneck isolated, or STOP condition
   reached with evidence.

### STOP conditions for Gemini Flash 3.7

Stop and report rather than improvise if any of these assumptions is false:

- an optimization cannot preserve native/Supabase authorization and behavior;
- production-like data or a safe benchmark database is unavailable for a schema
  decision;
- a new dependency is required but Android/iOS/Windows or deployment support is
  unverified;
- an API change cannot remain backward compatible with deployed mobile clients;
- audit, cache-retention, SLO, telemetry-provider, or restore-atomicity policy
  requires an owner decision;
- a migration requires destructive table rewrite or extended lock not covered by
  an approved maintenance window;
- baseline variance is larger than the claimed improvement;
- implementation would require editing applied migrations, bypassing the
  Repository interface, weakening RLS/auth checks, or exposing secrets.

An acceptable finish is not “all best practices implemented.” It is that the
P0/P1 bottlenecks supported by measurements are improved within the acceptance
criteria, lower-priority hypotheses are either proven and addressed or explicitly
deferred, and correctness/security/resource behavior is verified in both backend
modes and all supported mobile platforms.

## Plan Review

Reviewed on 2026-08-30 against the planning rubric and repository state at
`8811db8`.

| Dimension | Before | After | Resolution written into this plan |
| --- | ---: | ---: | --- |
| Completeness | 4/5 | 5/5 | Added cross-cutting failure contracts, per-slice deliverables, recovery rules, and explicit compatibility behavior. |
| Feasibility | 4/5 | 5/5 | Verified P0 claims and the installed Next analyzer command; corrected health migration semantics and made each tracer independently executable. |
| Scope | 4/5 | 5/5 | Added scope boundaries; moved cursor migration out of P0; separated minimum instrumentation from vendor telemetry; constrained each Antigravity run to one slice. |
| Testability | 4/5 | 5/5 | Added exact targeted proof per slice, benchmark metadata, pre-declared targets, artifact retention, and expected outcomes. |
| Risk | 4/5 | 5/5 | Added fail-closed auth, probe, batch, stream, cache, restore, migration, and adapter-split behavior alongside existing rollout/rollback gates. |
| Assumptions | 3/5 | 5/5 | Added verified, observed, and unverified assumptions with evidence, invalidation rules, fallbacks, and slice-specific STOP conditions. |

### Load-bearing claim verdicts

- **VERIFIED:** native health creates a new `Pool`, while readiness and liveness
  both call `/api/health`; the reusable pool is separate.
- **VERIFIED:** the mobile list passes an `offset` absent from its contract, the
  client does not serialize it, and the v1 API expects numeric inclusive
  `from/to` offsets. F03 now repairs only that existing contract.
- **VERIFIED:** the installed Next.js 16.3 documentation supports
  `npx next experimental-analyze --output` and writes analyzer artifacts under
  `.next/diagnostics/analyze`.
- **VERIFIED:** mobile dashboard reads are sequential, list adapters request
  exact counts, and protected mobile requests perform separate session/actor
  lookups.
- **OBSERVED, REVALIDATION REQUIRED:** F04's exact bundle/chunk sizes were
  measured during the audit but were not retained as committed artifacts. S0a
  must reproduce them; absence of the modules closes or narrows F04.

### Residual prerequisites, not global blockers

- A07 blocks only plan-dependent database/cursor/restore-scale decisions.
- A09 blocks only pooler, replica, PDB, HPA, and distributed-limiter rollout.
- A11 blocks only a restore semantic/atomicity change, not measurement or a
  behavior-preserving optimization.
- A12 blocks only adoption of a mobile storage dependency.

There are no unresolved plan-structure gaps before S0a, S0b, S1, or S2. Later slices
must stop at their named prerequisite rather than infer an operational or
product policy.
