# Current State

**Supabase retired.** Native (self-hosted PostgreSQL + in-app scrypt auth) is the only backend: `lib/supabase/`, `lib/db/supabase/`, `supabase/`, the `NEXT_PUBLIC_BACKEND` switch and the one-off `migrations/tool` workspace were removed. Statements below that describe two backends, Supabase adapters or the migration tool are historical.

Snapshot date: 2026-10-05 (classification v2 added). Timesheet entries now use an
explicit Type → Activity classification (`project`/`support`/`internal`), stored
in nullable `entry_type`/`activity_code`/`activity_other`/`ticket_number`
columns with a nullable `project_id`; historical rows keep their legacy format.
Defined once in `@vsis/contracts`, threaded through the DB adapters, reports,
backup/bundle portability, the offline queue and web/mobile forms. Rollout is
gated by the server-owned `TIMESHEET_CLASSIFICATION_V2` flag. See the 2026-10-05
entry in `ARCHITECTURE_DELTA.md`.

Phase 4 (provider retirement) is complete as of 2026-10-16: see the entry in `ARCHITECTURE_DELTA.md`.

## Purpose and direction

VSIS Timesheet is a web + mobile time-entry, leave/reminder, reporting, and administration system. Its current architectural direction is to keep one application/domain contract on the native PostgreSQL backend while preserving web/mobile behavior and authorization.

## Product/runtime

- Web: Next.js 16 App Router (`next` `^16.3.0`) with React 19.2.4.
- Mobile: standalone React Native application under `mobile/` for Android, iOS, and Windows.
- Shared packages: `@vsis/core` for platform-neutral calculations and validation,
  `@vsis/contracts` for canonical schemas/types/DTOs, and `@vsis/client` for
  typed HTTP operations. The root workspace covers `packages/*`; mobile consumes
  all three through local file dependencies.
- Backend: native only (no build-time selector).
- Auth/data: in-app email/password auth + signed session cookies + self-hosted PostgreSQL.
- Deployment: standalone/container flow via `Dockerfile`, Docker Compose, and `deploy/` manifests (Vercel also works with `DATABASE_URL`).

## Stable boundaries

- Server identity: `lib/auth/index.ts` facade.
- Browser identity/data: `lib/auth/client.ts` and `lib/data/client.ts`.
- Persistence: shared contracts in `lib/db/types.ts`; narrow domain ports and `lib/db/` composition modules export the native adapters directly.
- Web HTTP guards: `app/api/_http.ts`.
- Versioned bearer/opt-in browser-cookie HTTP guards: `app/api/v1/_http.ts`.
- Server Actions and the legacy `/api/auth`, `/api/data` routes: removed (2026-10-19); boundary tests forbid reintroducing them.
- Timesheet application slice: `/api/v1` services call
  `lib/domain/timesheets.ts`, which receives `TimesheetPersistence` through
  `lib/db/timesheets.ts`; the native adapter implements that port.
- Contract/mapping slice: `packages/contracts` owns the wire shape,
  `lib/api/v1/contracts.ts` maps server rows to DTOs, and browser/mobile clients
  consume the same released shape.
- Schema: additive migrations in `db/migrations/`.
- Runtime imported-history compatibility lives in
  `lib/idempotency/portable-retry.ts` and is covered by the application test/coverage gates.

## Current architecture issues / unknowns

No new active architecture defect is asserted by this setup task. The material unresolved operational unknowns are environment-specific: which migration versions are applied to each deployed database, production proxy/secret values, and whether future repository migration files have been deployed. Resolve those from the target environment rather than inferring them from Git.

## Verification entry points

Root scripts are authoritative in `package.json`: `lint`, `typecheck`, `test`, `test:coverage`, `build`, `e2e`, `a11y`, database integration workflows, benchmark, and k6 load test. Mobile workflows are defined by `mobile/package.json`.

Evidence: `package.json`, `README.md`, `AGENTS.md`.
