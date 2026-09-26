# Architecture

The fuller architecture reference is `docs/architecture/AI_ARCHITECTURE_CONTEXT.md`. This file keeps only the invariants needed for fast task orientation.

## Core shape

VSIS Timesheet is one Next.js application plus a standalone React Native client,
backed by two interchangeable server persistence/auth implementations.
`NEXT_PUBLIC_BACKEND` selects server/backend behavior at build time; browser
timesheet data access is backend-neutral HTTP through the versioned route.

Application features depend on backend-neutral boundaries:

- identity through `lib/auth/index.ts` / `lib/auth/client.ts`;
- persistence through narrow domain ports, composed by the corresponding modules in `lib/db/`;
- browser data through `lib/data/client.ts` and the versioned `/api/v1` routes;
- compatibility reads through `app/api/data/` where still required;
- mobile behavior through the versioned `/api/v1` routes and service/domain layers;
- request-time migration retry compatibility through `lib/idempotency/portable-retry.ts`,
  kept separate from the operator-only `tools/migration` workspace;
- shared calculations, schemas, DTOs, and typed HTTP through
  `@vsis/client -> @vsis/contracts -> @vsis/core`.

Each application slice follows the same shape as timesheets: actions and HTTP
services call a domain service, the service depends on a narrow port, and the
matching composition module in `lib/db/` selects the native or Supabase adapter.
Shared actor/result/input contracts and authorization guards live in
`lib/db/types.ts`. There is no global persistence dispatcher or aggregate
`Repository` interface. A port change that affects persistence must preserve
equivalent behavior in both provider adapters while both backends are supported.

## Authorization model

Profiles carry two independent role axes: permission role (`admin|pm|co|user`) and hierarchy role (`manager|team_lead|engineer|user`). A valid identity/session is only the first gate; active-state, permission, hierarchy/scope, and resource checks remain distinct.

Native mode enforces adapter authorization with parameterized SQL and application checks. Supabase mode combines actor checks with RLS and narrowly scoped RPCs. Read-only grouping RPCs remain `SECURITY INVOKER`.

## Data evolution

Native and Supabase schemas evolve independently through additive migration histories. A cross-backend schema behavior change normally requires a migration in both migration sets and corresponding adapter/test changes. Existing applied migrations are immutable.

The private `@vsis/migration-tool` workspace owns cross-provider migration operations and
their tests. Application runtime code cannot import it. Imported retry-history handling remains
an application concern because supported queued requests may reach normal `/api/v1` routes.

## Compatibility surfaces

- Public Server Action names/signatures in `app/actions.ts`.
- Shared persistence types, domain-port contracts, and adapter semantics.
- `/api/v1` response/auth contracts and server/mobile DTO parity.
- Web cookie authentication and CSRF behavior.
- Role-axis semantics and backend authorization parity.

Evidence: `docs/architecture/AI_ARCHITECTURE_CONTEXT.md`, `AGENTS.md`, `lib/db/types.ts`, `lib/domain/`, `lib/db/timesheets.ts`, `lib/auth/index.ts`, `app/api/_http.ts`, `app/api/v1/_http.ts`.
