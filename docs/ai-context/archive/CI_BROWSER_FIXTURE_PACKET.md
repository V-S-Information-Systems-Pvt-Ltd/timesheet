# CI browser fixture decision (PR12)

## Decision required

Repair the mutation and UI polish browser fixtures against the existing v1
transport, preserving their behavioral assertions on native and Supabase builds.
Starting revision: `6cb4a6da4e5144144ef877638f85d4fb9e4bc7f6`; clean worktree.

## Evidence and boundary

- FACT: `e2e/timesheet-mutations.spec.ts` and `e2e/ui-polish.spec.ts` mock
  legacy `/api/auth/*` and `/api/data/*`; mutations use dashboard Server Action
  envelopes. Current `lib/data/client.ts` uses backend-neutral `/api/v1/*` reads
  and PUT/DELETE/POST timesheet operations.
- FACT: `lib/auth/client.ts` uses `/api/v1/auth/browser/*` for native authentication
  and Supabase `/auth/v1/*` for provider authentication.
- FACT: `e2e/bounded-dashboard.spec.ts` demonstrates current profile, people,
  reference, backfill, layout, capability, report and timesheet response shapes.
- FACT: `app/dashboard/entries-table.tsx` guards snapshots during loading and
  failed reconciliation. Retained rows cannot be mutated until a successful read.
- INFERENCE: Updating test transport wiring resolves missing fixture rows/login
  failures without runtime changes. Browser runs must establish remaining gaps.
- UNKNOWN: The available Supabase production build may expose additional
  fixture assumptions. Native verification requires a coordinated later build.

Root expanded ownership to the native login response matcher in
`e2e/smoke.spec.ts`: the failing artifact reached the authenticated dashboard
but waited for `/api/auth/login`. Match `/api/v1/auth/browser/login`, preserving
real credentials and response validation. Root confirmed Supabase smoke's welcome
text matches both the heading and Next route announcer; scope that assertion to
the level-one heading. Do not mock or run credentialed smoke
locally; root owns its CI verification.

Root additionally assigned `e2e/bounded-dashboard.spec.ts` auth wiring after all
18 cases failed in Supabase CI: its native-only auth fixture needs the same
provider mocks and cookie isolation. Preserve its data/concurrency assertions.
Acceptance now includes all three mocked specs on both backend builds.

This bounded task starts from known files; no broad architecture rediscovery or
index rebuild is necessary. `ASTRA_ARCHITECT.md` and the decision packet template
inform this protocol; no agent escalation is requested. Other smoke and runtime code,
database operations, staging, commits, builds and deployment remain outside scope.

## Chosen protocol

1. Activation/login: install interceptors before navigation. Mock native browser
   auth and Supabase token/user/logout calls locally. Give Supabase an unsigned
   browser-only session; strip cookies from every forwarded framework request.
2. Normal writes: match v1 path and HTTP method, record requests, update only
   in-memory rows, and return the current success/error envelope. Reject and
   report unexpected API writes and every Server Action request.
3. Reconciliation: page reads return coherent captured rows. Only authoritative
   entries-page reads can be held or failed; independent tiles cannot consume
   a concurrency test's hold. Successful reads reconcile temporary IDs/order.
4. Retries/failed reads: retain visible rows read-only after refresh failure;
   assert blocked controls and no extra writes, then explicitly retry the read
   and verify authoritative committed rows and restored controls.
5. Stale artifacts/concurrency: retain delayed-write/read controls, remount locks,
   double-fire protection, rejection rollback, partial batches and stale-read
   assertions. Install routes and auth state anew for every isolated test page.
6. Isolation: a small shared auth/guard helper prevents duplicate security wiring;
   each spec owns its data and operation matching. No generic data dispatcher.

## Alternatives and risks

Keeping legacy action responses does not exercise today's transport. Runtime
changes or real database fixtures would expand ownership and introduce side
effects. Sharing all data dispatch would obscure the mutation-specific failure
and concurrency scenarios. The chosen change is test-only and reversible by
reverting these files; public application contracts do not change.

## Acceptance and validation

- Preserve all original mutation success, optimistic, concurrency, rejection,
  partial/error and accessibility cases; adapt failed reads to snapshot guards.
- Preserve UI viewport/theme, chart, filter persistence and accessibility checks.
- Assert no unexpected writes/Server Actions per test; never forward fixture
  cookies, API writes or hosted authentication calls.
- Run focused ESLint, TypeScript, Playwright discovery and both assigned specs
  against the existing Supabase build. Root owns native matrix/build coordination,
  CI rerun, final integration and push. Report passed/failed/unavailable separately.
- Include smoke in lint/type/discovery; root verifies real authenticated smoke.

## Verification evidence

- Passed: settled Supabase production-build fixture run, all 38 cases (18 bounded
  dashboard, 18 mutations, 2 UI polish), Chromium, two workers, 26.8 seconds.
- Passed: focused ESLint on all five test/helper files, application TypeScript,
  Playwright discovery (38 mocked cases plus 2 smoke cases), final diff check.
- Repaired: initial assertion run exposed three concurrency setups starting new
  writes after snapshot invalidation and two failed-read expectations. Both writes
  now begin before refresh; responses complete during held reconciliation. Failed
  reads assert retained read-only rows, blocked extra writes, retry and authoritative
  recovery. All five targeted repairs and the settled full fixture run passed.
- Environment-only attempts failed before assertions due startup proxy configuration,
  sandbox-local port access and browser-cache lookup. Verification succeeded using
  the existing build on loopback port 3107 with local server/browser outside the
  sandbox. No new build or runtime edits were made; that server was stopped.
- Passed root verification: native production build and all 38 mocked browser
  cases (29.2 seconds). Final isolation guard also records unexpected bounded
  dashboard writes in the shared assertion ledger.
- Pending: real credentialed smoke on both backends in CI's disposable seeded
  databases. No production operations ran.
