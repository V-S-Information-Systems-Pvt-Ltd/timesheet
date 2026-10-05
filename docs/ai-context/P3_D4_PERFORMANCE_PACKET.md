# P3 / D4 performance decision packet

Date: 2026-10-04. Scope: auth facade/adapters, browser data facade,
dashboard count caller, related tests. Existing D2 changes and migration
execution are outside this assignment. No subagents or expanded write ownership.

## Decision required

Can React render-pass caching save auth work for current callers without
changing validation freshness? Can unused browser counts be disabled through
caller-only changes using the actual HTTP transport?

## Current architecture and verified evidence

- FACT: `lib/auth/index.ts:getActor/getSessionUser` delegate to the selected
  backend. Serena references and targeted imports identify Route Handlers
  (`app/api/_http.ts`, `app/api/v1/_http.ts`, browser auth/password helpers,
  branding logo) and Server Actions (`app/actions/_shared.ts`, `superadmin.ts`).
  No current Server Component consumes this facade. Dashboard is a client
  component using `lib/auth/client.ts`.
- FACT: installed Next guidance in
  `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`
  describes React cache as deduplication within a single render pass. Installed
  `authentication.md` recommends it during a React render pass. Installed
  `15-route-handlers.md` describes separate HTTP request handlers. React's
  `react.react-server.development.js:cache` calls the underlying function when
  no cache dispatcher is installed. This is not general HTTP request caching.
- FACT: `lib/auth/native.ts:getSessionUserImpl` reads cookies, verifies JWT,
  and checks persisted session version on every call; `getActor` also reads
  current profile roles/active status. Password changes increment version;
  cookie setters/clearers mutate the current session. Supabase auth validates
  identity and reads the current profile. Preserve these validation boundaries.
- FACT: `lib/data/client.ts:getTimesheetsOverHttp` sends browser reads through
  `/api/v1/timesheets`, including Supabase mode. Its query type/serializer have
  no `includeCount`. `app/api/v1/timesheets/route.ts:GET` only extracts six
  named parameters; `packages/contracts/src/timesheets.ts:timesheetQuerySchema`
  also lacks the flag. Adding a browser flag alone would be silently ignored.
- FACT: persistence already supports `TimesheetListOptions.includeCount`:
  native skips count SQL, Supabase omits PostgREST exact count options.
  Defaults preserve exact counts. Native's count-free result uses numeric zero;
  do not silently redefine this public response contract in this batch.
- FACT: dashboard `fetchTimesheets` reads data/error only; month entry count
  derives from rows. Reports initial page uses exact count for `hasMore` and
  must retain it. Mobile list pagination also retains existing defaults.
- FACT: server CSV export already passes `includeCount:false`
  (`app/api/reports/export/route.ts`, `tests/reports-export-route.test.ts`).
  Reports subsequent pages/month scan do not consume counts but are outside
  the assigned caller scope. No export implementation change is needed here.

## Constraints, alternatives, and decision

P3-A: wrapping the existing facade with React cache adds no verified savings
for current consumers. Reject as an inert performance change. P3-B: explicit
request context wrappers could deduplicate Route Handler work, but require
new ownership and a mutation/invalidation protocol. P3-C: cache RSC auth reads
when an actual RSC consumer exists; reconsider alongside the separately scoped
SSR work. Decision: retain fresh auth validation; P3 deferred, no cache added.

D4-A: caller-only flag is ineffective because HTTP drops it. Reject an inert
patch. D4-B: use bounded expansion to route parser and shared schema, then
add browser serialization and dashboard opt-out. Default/explicit true retain
counts; strict string true/false validation avoids truthiness coercion. Retain
current response shape and paginator/mobile defaults. CSV export is already
optimized. Decision: root authorized the route/schema/test expansion before
implementation. Implement D4-B, keeping service and response contracts intact.

## Lifecycle, risks, and acceptance checks

Any future request cache must isolate concurrent requests and users, preserve
signed-out/error behavior, and avoid stale identity/profile after password
change, session revocation, role/active updates, or cookie set/clear. Recovery
and retries must revalidate; no global auth Map or mock React cache proof.
RSC caching tests require an actual supported render runtime; plain Vitest
cache wrappers cannot demonstrate render-pass savings.

D4 checks after expansion: browser flag reaches persistence; absent/true keeps
exact counts; false skips count in both adapters; malformed flags fail with
400; count/no-count requests do not share an in-flight deduplication key;
dashboard opts out; mobile/paginator defaults and export remain unchanged.
Run targeted auth/count/client/route regressions, lint and typecheck. No
database migration is needed or executed. Actual DB/HTTP performance remains
unmeasured; unit regressions verify transport forwarding and count options.

## Ownership boundary / unresolved questions

Required additional files: `app/api/v1/timesheets/route.ts` and
`packages/contracts/src/timesheets.ts`, plus related schema/route tests.
Root authorized these files for D4. P3 is deferred until P2 supplies an actual
RSC consumer; no current route savings are claimed. Root owns
architecture delta/plan updates; this packet is the worker's only doc change.

## Verification results

- PASSED: focused D4 client/cache/query/cookie/persistence tests, 6 files,
  142 tests. Count omission/true/false, malformed input, HTTP failure, distinct
  in-flight keys, native count SQL suppression and Supabase count options.
- PASSED: auth/session/password/mobile-auth/browser-client/CSV export
  regressions, 9 files, 130 tests. Total: 15 files / 272 tests.
- PASSED: `npm run typecheck`, `npm run lint`, final scoped diff inspection,
  and `git diff --check`. Auth implementation and existing D2 work untouched.
- SKIPPED: production builds, browser E2E, live database integration and
  benchmarks. No measured latency claim. No cache added, so no RSC runtime
  cache/isolation test is claimed. Migration execution remains parked.
- Tool limitation: RTK initialization failed; original npm commands succeeded.
- Ownership returned to root after D4. D3 requires separate assignment.
