# Architecture

The fuller architecture reference is `docs/architecture/AI_ARCHITECTURE_CONTEXT.md`. This file keeps only the invariants needed for fast task orientation.

## Core shape

VSIS Timesheet is one Next.js application plus a standalone React Native client, backed by two interchangeable server persistence/auth implementations. `NEXT_PUBLIC_BACKEND` is the build-time selector shared by browser and server code.

Application features depend on backend-neutral boundaries:

- identity through `lib/auth/index.ts` / `lib/auth/client.ts`;
- persistence through the `Repository` contract in `lib/db/repository.ts`;
- browser/native HTTP data through `lib/data/client.ts` and `app/api/data/`;
- mobile behavior through the versioned `/api/v1` routes and service/domain layers.

`lib/db/index.ts` selects `nativeRepository` or `supabaseRepository`. A contract change that affects persistence must be implemented with equivalent behavior in both adapters.

## Authorization model

Profiles carry two independent role axes: permission role (`admin|pm|co|user`) and hierarchy role (`manager|team_lead|engineer|user`). A valid identity/session is only the first gate; active-state, permission, hierarchy/scope, and resource checks remain distinct.

Native mode enforces repository authorization with parameterized SQL and application checks. Supabase mode combines actor checks with RLS and narrowly scoped RPCs. Read-only grouping RPCs remain `SECURITY INVOKER`.

## Data evolution

Native and Supabase schemas evolve independently through additive migration histories. A cross-backend schema behavior change normally requires a migration in both migration sets and corresponding adapter/test changes. Existing applied migrations are immutable.

## Compatibility surfaces

- Public Server Action names/signatures in `app/actions.ts`.
- `Repository` types and method semantics.
- `/api/v1` response/auth contracts and server/mobile DTO parity.
- Web cookie authentication and CSRF behavior.
- Role-axis semantics and backend authorization parity.

Evidence: `docs/architecture/AI_ARCHITECTURE_CONTEXT.md`, `AGENTS.md`, `lib/db/repository.ts`, `lib/db/index.ts`, `lib/auth/index.ts`, `app/api/_http.ts`, `app/api/v1/_http.ts`.
