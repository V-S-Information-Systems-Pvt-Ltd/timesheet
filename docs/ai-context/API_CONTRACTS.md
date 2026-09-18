# API Contracts

## Server Actions

`app/actions.ts` is the stable public re-export surface. Implementations live under `app/actions/`. Preserve existing names/signatures unless the task explicitly changes a public contract. Client-facing failures follow the established `{ error }` shape.

## Web REST

- Authentication endpoints: `app/api/auth/`.
- Current browser timesheet reads: `/api/v1/timesheets` through
  `lib/data/client.ts` with same-origin cookie credentials.
- Compatibility data endpoints: `app/api/data/` where still required.
- Shared guards: `app/api/_http.ts`.

State-changing cookie requests must preserve origin/CSRF checking and active-account authorization.

## Mobile REST

The versioned contract is under `/api/v1`. Routes should remain thin: authenticate/parse, call service/domain logic, map to the established success/error envelope. The server DTO/schema boundary and `mobile/src/api/contracts.ts` must evolve together.

Canonical timesheet schemas, input types, and response DTOs live in
`packages/contracts/src/timesheets.ts` and are exported from its package index.
`lib/api/v1/contracts.ts` maps server-side `Timesheet` rows to the flat
`TimesheetEntry` wire DTO; it does not define a competing contract. The typed
HTTP operations in `packages/client` and browser/mobile consumers must preserve
that released shape.

Protected mobile routes are bearer-authenticated by default. Cookie authentication is an explicit per-route opt-in in `requireMobileActor`/`withMobileActor` behavior.

## Repository contract

`lib/db/repository.ts` is also an application API. Reads return data/throw according to established method semantics; writes use `DbWrite` (`{ error: string | null }`) and related result types. New persistence behavior belongs in this contract and both backend implementations rather than in direct page/route database access.

## Compatibility checklist

When changing a contract, trace callers and consumers with Serena first, then check: browser client, mobile client, native adapter, Supabase adapter, authorization behavior, migrations/RLS, and matching tests.

Evidence: `app/actions.ts`, `app/actions/`, `app/api/_http.ts`, `app/api/v1/_http.ts`, `lib/db/repository.ts`, `lib/data/client.ts`, `mobile/src/api/contracts.ts`.
