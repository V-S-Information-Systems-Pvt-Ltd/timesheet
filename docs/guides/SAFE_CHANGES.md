# Safe changes: timesheets and shared boundaries

This guide is the first navigation stop for changes that cross the web,
server, shared packages, or mobile client. It describes the current source
layout; `AGENTS.md`, the installed framework documentation, and the source code
remain authoritative.

## Start with the two representative drills

### Drill 1: change timesheet create/update rules

For a change involving daily limits, inactive actors, ownership, or the
backfill window, follow this path:

1. For web mutations, start at the stable Server Action exports in
   [`app/actions.ts`](../../app/actions.ts), then open
   [`app/actions/timesheets.ts`](../../app/actions/timesheets.ts). `logEntry`
   and `updateTimesheet` resolve an active actor, parse the shared input shape,
   call the domain operation, and preserve the `{ error }` action result.
2. For the current browser read path, follow
   [`lib/data/client.ts`](../../lib/data/client.ts). `getTimesheets` requests
   `/api/v1/timesheets` with same-origin credentials and maps the flat DTO back
   to the row shape consumed by the web UI. The older
   [`app/api/data/timesheets/route.ts`](../../app/api/data/timesheets/route.ts)
   remains a compatibility read endpoint; do not mistake it for the browser's
   current data path.
3. Put shared business rules in
   [`lib/domain/timesheets.ts`](../../lib/domain/timesheets.ts). The domain
   validates the input and active actor, checks ownership and the backfill
   window, enforces the 24-hour daily cap, sanitizes descriptions, and charges
   the write budget through `TimesheetDomainDeps`.
4. Follow composition through
   [`lib/db/timesheets.ts`](../../lib/db/timesheets.ts). `timesheetDeps`
   supplies the narrow `TimesheetPersistence` port, the date clock, and the
   daily write budget. The domain must not resolve cookies, headers, a global
   repository, or a provider client.
5. If persistence behavior changes, update
   [`lib/domain/timesheets-port.ts`](../../lib/domain/timesheets-port.ts) only
   when the port changes, then keep
   [`lib/db/native/timesheets.ts`](../../lib/db/native/timesheets.ts) and
   [`lib/db/supabase/timesheets.ts`](../../lib/db/supabase/timesheets.ts)
   behaviorally equivalent. A schema change needs additive native and Supabase
   migrations.
6. For mobile or HTTP behavior, trace
   [`app/api/v1/timesheets/route.ts`](../../app/api/v1/timesheets/route.ts),
   [`app/api/v1/timesheets/[id]/route.ts`](../../app/api/v1/timesheets/[id]/route.ts),
   and the related batch/duplicate routes into
   [`lib/api/v1/services/timesheets.ts`](../../lib/api/v1/services/timesheets.ts).
   Routes authenticate and parse; the service maps domain results to the
   versioned response envelope.

The focused checks for this drill are:

- `npm test -- tests/timesheet-domain.test.ts tests/timesheet-rate-limit-service.test.ts tests/timesheets-api.test.ts tests/mobile-timesheets-route.test.ts tests/mobile-timesheets-cookie-auth.test.ts tests/data-client-pagination.test.ts`
- `npm test -- tests/actions.test.ts tests/actions-extra.test.ts tests/action-policy.test.ts`
  when the Server Action path or its coverage is changed.
- `npm run typecheck` and `npm run lint` when TypeScript or test files change.

### Drill 2: change a timesheet response field

Trace the contract in both directions before editing a consumer:

1. Define or change the released wire shape in
   [`packages/contracts/src/timesheets.ts`](../../packages/contracts/src/timesheets.ts)
   and export it from
   [`packages/contracts/src/index.ts`](../../packages/contracts/src/index.ts).
   `@vsis/contracts` depends on `@vsis/core`; it owns canonical request
   schemas, input types, and response DTOs.
2. Check server mapping in
   [`lib/api/v1/contracts.ts`](../../lib/api/v1/contracts.ts). `mapTimesheetDto`
   converts server rows into the flat `TimesheetEntry` DTO. This is a server
   database-to-wire mapping, not a second public contract.
3. Check the typed HTTP layer in
   [`packages/client`](../../packages/client) and the browser adapter in
   [`lib/data/client.ts`](../../lib/data/client.ts), including
   `toTimesheetRow` and every `dataClient.getTimesheets` caller.
4. Check the mobile contract mirror and consumers in
   [`mobile/src/api/contracts.ts`](../../mobile/src/api/contracts.ts),
   [`mobile/src/api/client.ts`](../../mobile/src/api/client.ts),
   `mobile/src/screens/TimesheetListScreen.tsx`, and
   `mobile/src/screens/EditTimeScreen.tsx`. The mobile package consumes all
   three shared packages through its file dependencies.
5. Update contract, server mapping, browser, and mobile tests together. Keep
   compatibility fields and response envelopes unless the change explicitly
   includes a versioned contract decision.

The focused checks for this drill are:

- `npm test -- tests/boundary-enforcement.test.ts tests/domain-adapter-contracts.test.ts tests/mobile-contract-parity.test.ts tests/vsis-client.test.ts tests/data-client-pagination.test.ts`
- `npm --prefix mobile run typecheck`
- `npm --prefix mobile test` for mobile consumer changes.

## Choose the layer deliberately

| Change | Primary location | Required follow-through |
| --- | --- | --- |
| Business rule or validation | `lib/domain/` | Domain success/failure tests; transport tests when mapping changes |
| Server Action behavior | `app/actions/` | Preserve `app/actions.ts` names/signatures and `{ error }`; run action policy/security checks |
| HTTP-only behavior | `app/api/` and `lib/api/v1/services/` | Route/service tests; keep guards and response envelopes stable |
| Shared request/response contract | `packages/contracts/` | Server mapping, `@vsis/client`, browser callers, mobile callers, and parity tests |
| Typed transport/client behavior | `packages/client/`, `lib/data/client.ts`, or `mobile/src/api/` | Client tests plus the affected web/mobile consumer checks |
| Persistence behavior | `lib/domain/*-port.ts` and both adapter trees | Native/Supabase adapter parity, authorization tests, and integration evidence |
| Schema or durable data behavior | `db/migrations/` and `supabase/migrations/` | Additive paired migrations, migrated-database checks, and rollback/authorization evidence |

Keep the existing dependency direction:

```text
web UI -> browser auth/data facade -> HTTP or Server Actions
mobile UI -> @vsis/client / mobile ApiClient -> /api/v1
HTTP/actions -> service/domain -> narrow domain port -> native or Supabase adapter
@vsis/client -> @vsis/contracts -> @vsis/core
```

The broad `Repository` facade remains a compatibility boundary for operations
that have not moved to a narrow domain port. Do not introduce a second
provider-specific path from a page, action, route, or shared package.

## Ownership and review routing

No primary or backup maintainer identities are confirmed by repository source.
Route changes through the repository maintainer and request the role-based
review below; fill in named identities only after the maintainer confirms them.

| Responsibility | Review trigger | Escalation route |
| --- | --- | --- |
| Domain rules and validation | Changes to timesheet, leave, reporting, or shared calculations | Domain owner role, then repository maintainer |
| Persistence and migrations | Port, adapter, SQL, RLS, transaction, or schema changes | Persistence/database reviewer; include both backend tracks |
| Identity and security | Auth, sessions, authorization, roles, CSRF/origin, rate limits, or secrets | Security reviewer and repository maintainer |
| Shared packages | `packages/core`, `packages/contracts`, or `packages/client` changes | Contract owner role plus all web/server/mobile consumers |
| Web transport and UI | Server Actions, `/api`, browser facades, or web components | Web owner role; include contract/domain reviewers when crossed |
| Mobile transport and UI | `mobile/src`, platform storage, offline queue, or native packaging | Mobile owner role; include API/contract reviewers when crossed |

Joint review is required when a change crosses a boundary. A reviewer
assignment never replaces the applicable tests, backend parity checks, or
deployment evidence.

## Change-to-check map

| Evidence to establish | Existing checks |
| --- | --- |
| Valid create/update behavior | `tests/timesheet-domain.test.ts`, `tests/actions.test.ts`, `tests/mobile-timesheets-route.test.ts` |
| Inactive actor rejected before persistence | `tests/timesheet-domain.test.ts`, `tests/actions.test.ts`, `tests/action-policy.test.ts` |
| Other-user edit/delete forbidden and admin exception | `tests/timesheet-domain.test.ts`, `tests/actions-extra.test.ts` |
| Daily total never exceeds 24 hours | Domain, action, and mobile route tests listed above |
| Exhausted write budget returns `429 RATE_LIMITED` without a write | `tests/timesheet-rate-limit-service.test.ts`, `tests/timesheet-domain.test.ts`, `tests/mobile-timesheets-route.test.ts` |
| Browser query validation and DTO mapping | `tests/mobile-timesheets-route.test.ts` (current `/api/v1` path), `tests/timesheets-api.test.ts` (compatibility path), `tests/data-client-pagination.test.ts`, `tests/data-client-native.test.ts`, `tests/data-client-supabase.test.ts` |
| Package boundaries and adapter method parity | `tests/boundary-enforcement.test.ts`, `tests/domain-adapter-contracts.test.ts` |
| Server-side DTO shape and role mapping | `tests/mobile-contract-parity.test.ts` |

Structural tests are useful guardrails but are not runtime proof. In
particular, `domain-adapter-contracts.test.ts` compares exported method names;
`mobile-contract-parity.test.ts` tests server-side mapping, not an installed
mobile client against a deployed server. RLS, transaction/concurrency,
cross-version, live Supabase, and migrated PostgreSQL behavior require their
appropriate integration or deployment workflows.

For application changes, keep both backend builds compatible. For persistence
or authentication changes, add the relevant regression coverage and report
missing `TEST_DATABASE_URL`, hosted credentials, device SDKs, or other external
evidence as unavailable rather than passing.
