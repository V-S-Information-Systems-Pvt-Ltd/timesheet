# P2 — Server-rendered dashboard continuation packet

## Consolidated R4 calendar invariant (root, second repair)

The first form repair is insufficient: the rebuilt deterministic browser case
still reports React hydration error 418. Reviewer/source identify table relative
day labels (`entries-table.tsx:todayISO`, Today/Yesterday grouping) and root found
`leave-panel.tsx` renders Today in its subtitle and initializes a local month.
Resolve the whole initial-render calendar protocol before another patch/review.

- SSR and the first hydration render must use the same unknown calendar snapshot.
  Keep seeded table rows as literal dates, without relative labels/today anchors,
  date-based eligibility or Jump to Today until the shared browser day is known.
- Date-entry controls and other unseeded calendar widgets may activate after the
  browser snapshot is available. Audit dashboard child render-time dates once;
  gate dependent leaf widgets at the parent or pass the same confirmed calendar.
  Existing async-only row dates do not need unrelated refactoring.
- Browser activation initializes local day/month, bounds and relative labels
  together. Preserve P1 locks/session controllers, existing drafts and retries;
  normal rerenders must not remount a live form or reset mutations.
- Keep UTC/provider/auth behavior unchanged. Reject suppressHydrationWarning,
  a server timezone assumption, or hiding the seeded table until JavaScript.
- Acceptance: real SSR rows dated on server Today, a different browser calendar,
  zero hydration errors, correct local input value/min/max/subtitle; seeded rows
  remain in HTML and auth handoff/CRUD/paging tests remain green.

### Consolidated repair protocol (worker, before second patch)

One mount-owned `useBrowserToday` snapshot in DashboardClient governs all initial
calendar markup. Its empty server snapshot is also the first hydration snapshot.
Pass this value explicitly to the seeded EntriesTable and TimeEntryForm. Unknown
calendar: table groups use literal dates, no relative label or today anchor;
Jump/Edit Last/Undo Last and date-dependent writes remain disabled. Table rows,
counts and pager stay rendered. Known calendar: activate labels/eligibility and
form bounds together; no keys depend on day/month and no day effect resets state.

Audit FACTS against current source: EntriesTable was the remaining initial seeded
row clock (Today/Yesterday, anchor and eligibility). LeavePanel renders Today and
initializes summaryMonth from its own clock; gate both own/admin leaves until the
shared day is known and pass that day for subtitle/month initialization. TeamView
has no clock/date presentation. RemindersPanel computes now but initial async rows
are empty, so its initial markup is clock independent. GlobalRemindersPanel formats
only async fetched rows. Telegram starts empty; export date inputs start empty;
profile/people/reference/layout panels have no render-time calendar. Mutation-only
created_at/CSV/report date handling remains outside initial rendering. No remaining
unseeded row-only clocks need refactoring. Shared day updates leave existing form,
table selection/dialogs/locks and leave month selection mounted and intact.

Verification: expand the calendar regression to render the actual seeded dashboard
(server-Today and server-Yesterday rows) under opposing server/browser days; compare
unknown server and hydration HTML, then assert local row labels/anchor/eligibility,
entry bounds and leave subtitle/initial month. Root's production fixture is still
required to prove real hydration and no error 418 after rebuilding this second repair.

Second-repair handoff: EntriesTable now consumes the shared day; initial seeded
rows use literal group dates and retain HTML while day-dependent controls/anchors
are inactive. Both LeavePanel variants are parent-gated and consume the same day
for subtitle and initial summaryMonth. There are no calendar-dependent keys or
state-reset effects. Time-entry drafts and leave month selections remain mounted
on later day changes; parent mutation/session controllers are unchanged.

Focused result: 73 tests / 5 files passed, including 7 calendar render cases that
render the actual DashboardClient with real seeded rows and compare SSR against
the first hydration snapshot at a future browser day. Typecheck passed; focused
lint has zero warnings/errors. Root owns the rebuilt production browser proof,
both builds/full matrix and R4 closure. Earlier single-form repair did not close
R4 and its browser result must not be reused for the consolidated delta.

Status: closed on 2026-10-04. The consolidated calendar repair passed the
rebuilt native browser boundary case and the settled verification matrix.

## Decision required

Resolve authorized initial dashboard data in a Server Component, projecting a
serializable client seed without changing pending/error/active account gates,
optimistic mutations, retries, session transitions or independent read failures.
P3 React render-pass memoization is useful only with this actual RSC consumer;
keep Route Handler authentication fresh.

## Verified source evidence

- `lib/auth/index.ts`: session and actor facade. Native cookie validation checks
  current session version; actor resolution checks live role/active flags.
- `lib/domain/people.ts`: self-profile domain read permits inactive actors;
  preserve error/missing distinctions rather than displaying pending approval.
- `lib/api/v1/services/reference.ts`, `lib/db/reference.ts`: reference reads.
- `lib/domain/workspace.ts`, `lib/db/workspace.ts`: backfill/default layouts.
- `lib/api/v1/services/people.ts`: use scoped listPeopleService rather than
  admin-only listAdminUsersService for manager/team-lead/CO parity.
- `lib/roles.ts:isSuperAdminActor`: capability role policy. Branding is already supplied by root layout through
  cached `lib/branding-server.ts`.
- Dashboard client retains auth subscription, logout, profile retry and inactive
  account recheck. `lib/navigation.ts` and navigation-flow tests govern gates.

## Selected constraints and acceptance

Whitelist fields through existing DTO mappers; never pass raw persistence rows,
password/session fields or provider secrets to client props. Supabase people
reads may select all storage columns, making projection necessary. Align actor,
profile and session IDs and role/active state before privileged reads.

Keep ancillary-read failures independent rather than collapsing them into one
all-or-nothing Promise.all. Seed the final P1 table query and totals/presence
state without immediately repeating initial browser reads. Subsequent client
authentication, URL transitions and mutations still refresh authoritatively.

Installed docs: `01-app/01-getting-started/05-server-and-client-components.md`,
`01-app/02-guides/authentication.md` (cache and auth streaming), and
`01-app/03-api-reference/04-functions/cookies.md` under next/dist/docs.

## Resolved lifecycle protocol (P2 + render-pass P3)

1. Activation: Server Component awaits searchParams and a React `cache` composite
   render identity. Resolve facade actor once; derive `{id,email}` from a present
   actor. Only a null actor falls back to facade session lookup. A cached self
   profile consumer reuses that same composite identity. Route Handlers keep their
   uncached authentication; no provider/auth backend changes or cross-request cache.
2. Projection/gates: explicit fields only, including nested layout tile/module
   fields and embedded timesheet/reference joins. Signed-out is a client-compatible
   fallback (existing fake-client-auth browser fixtures have no server cookie).
   Missing/failed profile is the existing error view; inactive profile is pending.
   Actor-null with successful session is retryable profile-unavailable (P2-R1).
   Thrown identity/storage failure has its own retryable identity-error view;
   an unknown/null client initial event cannot downgrade that error to signed-out.
   Before ancillary reads require present actor and matching profile ID, email,
   permission/hierarchy roles and active flags. A mismatch fails closed with retry.
3. Initial reads: independently settle projects, active activity types, workspace
   backfill/default layouts, role-scoped people, bounded URL table page and grouped
   monthly totals through domain ports. Capability is server role policy. Errors
   retain independent seed results; neither one ancillary failure nor one empty
   list discards successful siblings. No raw persistence record reaches RSC props.
4. Hydration/completion: client state initializes synchronously from the immutable
   mount seed, so authenticated HTML renders profile/reference/table immediately.
   Controllers hydrate without fetching. The first matching INITIAL_SESSION event
   retains seeded reads. Browser auth session validation still runs. Independent
   leaf widgets/Telegram and local Today retain their own reads.
5. Calendar: seed includes exact month from/to. Seed totals remain loading until
   the browser confirms those bounds equal `dashboardMonthRange()` locally. A
   mismatch refreshes only totals. No timezone cookie or calendar-policy change;
   no server-month total is displayed before browser confirmation. Today always
   uses the independent browser-local limit-1 no-count read.
6. Auth handoff/retry: matching initial confirmation preserves even pre-confirmation
   writes. Same-identity SIGNED_IN/TOKEN_REFRESHED/USER_UPDATED validate profile freshly while
   retaining locks/controllers/generation. Only actual identity/session replacement
   or a confirmed authorization-scope change increments generation and clears old
   profile/page/overlays/selections/locks. Old-session callbacks cannot touch new locks.
   Seed errors expose existing retry. Pending profile keeps its 15-second poll.
   Async ancillary success and error are generation guarded. Unmount invalidates
   all callbacks. Session-bound profile/people/reference/layout/backfill/capability
   HTTP reads pass `deduplicate:false`, preventing a new session from joining old
   same-URL global singleflight (P2-R3). Tabs use native history just like the pager,
   avoiding unused RSC seed reads during client query navigation.
   controllers and pending callbacks. Initial events arriving after logout cannot
   re-adopt the seed.
7. Stale RSC/concurrent mutation: only the first mount consumes the seed. Subsequent
   RSC props from query navigation never replace session, controller, selection,
   locks, reference edits or optimistic state. Client URL pager requests remain
   scoped and fresh. Writes continue P1 snapshot/locks protocol. Cleanup/retry
   does not retain a prior session's success/error or render-pass identity cache.

FACT baseline (root live native cookie probe): authenticated GET /dashboard HTML
does not contain `Welcome back`. Initial client requests included auth/browser/me,
layout/web, profile, reference (twice), reports, settings/backfill, people,
capabilities and multiple timesheets, plus independent leaves/reminders widgets.
No latency claim. Acceptance excludes independent leaf/Today/session reads from
the no-initial-seeded-read-duplicates assertion.

## Finding ledger / acceptance evidence to collect

| ID | Scenario | Protocol / verification |
| --- | --- | --- |
| P2-AUTH | Actor/profile drift or missing profile | No privileged sibling reads; missing/error/pending distinct; unit gate tests |
| P2-DTO | Raw select* secrets and nested unknown fields | Explicit projection + serialized sentinel exclusion tests |
| P2-SEED | Initial duplicate GETs / spinner | Hydrated controller tests + real native-cookie SSR HTML/browser fixture |
| P2-LIFE | Late seed/auth/ancillary response during writes/logout | Mount-only seed + generation guarded successes/errors; transition tests |
| P2-MONTH | Server/client month boundary mismatch | Hide unconfirmed totals; refresh only mismatch, unit boundary test |
| P3-CACHE | Duplicate render auth / cross-request stale role | Composite render cache actual page/profile consumers; facade call tests; live SSR freshness |
| P2-R1 | Actor-null with successful session | Retryable profile-unavailable, never infer missing or pending from null actor |
| P2-R2 | Initial/token confirmation during live write | Matching INITIAL preserves seeded generation; TOKEN_REFRESHED preserves locks until confirmed scope change |
| P2-R3 | New Bob session joins delayed Alice facade request | Optional facade deduplicate:false forwarding + delayed actual-facade regression |
| P2-R4 | Server/browser local days differ in newly rendered entry form | Defer date-dependent form until browser calendar snapshot; identical SSR/initial hydration placeholder; local default/subtitle/min/max initialized together |

### P2-R4 consolidated calendar repair

SSR and initial hydration use an empty `useSyncExternalStore` server calendar
snapshot, independent of the server/browser timezone. The entry form renders a
stable Card placeholder without date inputs, submit or quick-fill actions. After
hydration the browser-local snapshot initializes the actual form once: its date
default and maximum use that day, and subtitle/minimum use the corresponding
backfill boundary. Existing draft state stays mounted through subsequent date
snapshots. No server calendar inference, cookie or policy change. Until calendar
activation, the seeded table uses a conservative edit boundary; local Today
presence remains its independent no-count read. Auth/controllers/locks/seeds are
unchanged. Unit checks cover opposing day/month/year boundaries, unchanged SSR
and hydration markup, and enabled local form bounds under both backfill modes.
The rebuilt live timezone-boundary browser case is closed below.

R4 focused evidence: `tests/dashboard-calendar-hydration.test.ts` exercises the
actual server/client snapshot callbacks and entry-form markup with opposing
Pacific/Kiritimati and America/Los_Angeles local dates at month/year boundaries.
Server and hydration snapshots produce byte-identical placeholder HTML with no
entry input/submit/quick-fill controls; local activation supplies matching default,
max, minimum and subtitle under days/month_start backfill. This is a snapshot
contract/render test; root's real React hydration fixture remains the live proof.
73 tests / 5 files passed (calendar + lifecycle/month/page/bulk regressions),
typecheck and focused lint passed with zero warnings/errors. The rebuilt native
fixed-2099-day browser case then passed with zero page/hydration errors and
correct browser-local value/min/max/subtitle. R1/R2/R3 were already closed.

UNKNOWN before implementation: real RSC render cache cardinality cannot be proved
by bare Vitest React cache calls; live SSR fixture proves rendering/freshness while
request-scope caching follows React cache in the installed Next auth guide. Root
may instrument isolated native auth reads for exact cardinality. No production
or provider operations.

## Settled worker handoff

Application ownership returned to root after focused verification. Server entry is
`app/dashboard/page.tsx`; client orchestration is `dashboard-client.tsx`. Seed
projection/protocol is `lib/dashboard-seed.ts`, server composition is
`dashboard-seed-server.ts`, and RSC-only identity cache is `lib/auth/render.ts`.
P2-R1/R2/R3/R4 are implemented and closed. A same-identity SIGNED_IN recovery
also preserves write generation.

Passed at handoff: 110 tests / 7 files (seed/server/lifecycle/render identity,
actual HTTP cache isolation, month totals, bounded paging and bulk lifecycle),
`tsc --noEmit`, focused ESLint with zero warnings/errors, and `git diff --check`.
No worker full coverage/build/database/browser runs. `e2e/dashboard-ssr.spec.ts`
is type/lint checked and now root-owned to finish/run on its native server. It
requires NEXT_PUBLIC_BACKEND=native, E2E_BASE_URL and seeded E2E credentials;
uses cookie login, verifies rendered HTML/no initial seeded GETs/native history,
and intercepts the delayed batch write (no real timesheet write).

Final root verification on the settled source:

- full coverage passed: 74.19% statements, 66.65% branches, 80.76% functions,
  77.45% lines;
- full lint and typecheck passed;
- native and Supabase production builds passed;
- the real native browser calendar-boundary regression passed after rebuild;
- the selected dashboard/report/accessibility browser matrix passed 25 flows.
  Its only initial failure was authentication for the configured
  `test-pending@vsis.lk` account, which is absent from the disposable database.
  Re-running that same pending-account flow with the database's seeded inactive
  `deactivated@vsis.lk` fixture passed, so all 26 selected flows are covered.

React `cache` is confined to the P2 render consumer and route authentication
remains uncached. Focused facade tests prove one actor resolution and the null
actor fallback contract; exact PostgreSQL statement cardinality was not
separately captured. Monthly aggregate intentionally renders Loading until
browser-local bounds are confirmed, so no server-timezone total flashes.
