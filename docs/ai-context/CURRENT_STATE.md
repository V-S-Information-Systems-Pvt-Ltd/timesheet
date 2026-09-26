# Current State

Snapshot date: 2026-09-26. Phase 1 facade retirement, Phase 2 migration-tool isolation, and Phase 3 browser data/authentication, timesheet-mutation and project/user-administration slices are implemented on `arch/architecture-simplification` and remain uncommitted. Other Phase 3 action/admin slices remain open.

## Purpose and direction

VSIS Timesheet is a web + mobile time-entry, leave/reminder, reporting, and administration system. Its current architectural direction is to keep one application/domain contract portable across two backend modes while preserving web/mobile behavior and authorization parity.

## Product/runtime

- Web: Next.js 16 App Router (`next` `^16.3.0`) with React 19.2.4.
- Mobile: standalone React Native application under `mobile/` for Android, iOS, and Windows.
- Shared packages: `@vsis/core` for platform-neutral calculations and validation,
  `@vsis/contracts` for canonical schemas/types/DTOs, and `@vsis/client` for
  typed HTTP operations. The private `@vsis/migration-tool` workspace owns operator-only
  cross-provider migration commands and verification. The root workspace covers `packages/*`
  and `tools/*`; mobile consumes
  all three through local file dependencies.
- Backend selection: `NEXT_PUBLIC_BACKEND` chooses `supabase` (default) or `native` at build time.
- Supabase mode: Supabase Auth + Postgres/PostgREST/RLS.
- Native mode: in-app email/password auth + signed session cookies + self-hosted PostgreSQL.
- Deployment: Vercel for Supabase mode; standalone/container flow for native mode via `Dockerfile`, Docker Compose, and `deploy/` manifests.

## Stable boundaries

- Server identity: `lib/auth/index.ts` facade.
- Browser identity/data: `lib/auth/client.ts` and `lib/data/client.ts`.
- Persistence: shared contracts in `lib/db/types.ts`; narrow domain ports and `lib/db/` composition modules select native or Supabase adapters directly.
- Web HTTP guards: `app/api/_http.ts`.
- Versioned bearer/opt-in browser-cookie HTTP guards: `app/api/v1/_http.ts`.
- Server Actions: public surface re-exported by `app/actions.ts`, implementations in `app/actions/`.
- Timesheet application slice: web actions and `/api/v1` services call
  `lib/domain/timesheets.ts`, which receives `TimesheetPersistence` through
  `lib/db/timesheets.ts`; native and Supabase adapters implement that port.
- Contract/mapping slice: `packages/contracts` owns the wire shape,
  `lib/api/v1/contracts.ts` maps server rows to DTOs, and browser/mobile clients
  consume the same released shape.
- Schema: additive native migrations in `db/migrations/`; additive Supabase migrations in `supabase/migrations/`.
- Migration operations: `npm run migration` enters `tools/migration/src/cli-entry.ts`; application
  code is forbidden from importing the package. Runtime imported-history compatibility lives in
  `lib/idempotency/portable-retry.ts` and is covered by the application test/coverage gates.

## Repository intelligence

- Understand Anything graph: `.ua/knowledge-graph.json`; metadata analysis commit `55545e77b7b655b0f72e0b5d889ee61ada6d87e7`.
- Structural validation on 2026-09-17 found 1,867 nodes, 3,601 edges, 10 layers, and 9 tour steps with no dangling edge, layer, or tour references. The graph is stale relative to the current source: 84 non-`.ua` files differ from its metadata commit. Treat it as navigation evidence only until an incremental refresh is run.
- Atlas: available as `atlas`; use a 2k-token map first for unfamiliar work.
- Serena: project config in `.serena/project.yml`, TypeScript LSP; symbol/reference lookup validated.
- RTK: available as `rtk`; use it for noisy supported CLI commands where full raw output is not required.

## Current architecture issues / unknowns

No new active architecture defect is asserted by this setup task. The material unresolved operational unknowns are environment-specific: which migration versions are applied to each deployed database, production proxy/secret values, and whether future repository migration files have been deployed. Resolve those from the target environment rather than inferring them from Git.

## Last meaningful architecture update

The uncommitted architecture-simplification branch removes the global repository
facade in favor of the existing narrow domain ports/composition modules (Phase 1),
then separates the operator migration package from request-time portable retry
compatibility (Phase 2). Phase 3 migrates browser data/authentication and individual
and bulk-edit timesheet callers plus project/user administration to versioned transports, with legacy auth aliases
and Server Actions retained for rollback. Supabase provider auth remains SDK-owned;
mobile bearer contracts and persistence/retry behavior remain compatible. See
`docs/ai-context/ARCHITECTURE_DELTA.md`, the phase decision packets, and the Phase 3
transport matrix for verified boundaries, remaining slices and acceptance evidence.

## Working-tree note

`.ua/` is ignored local Understand Anything state. Preserve its graph, metadata, fingerprints, and any intermediate diagnostics unless a separate task explicitly owns a refresh or cleanup.

## Verification entry points

Root scripts are authoritative in `package.json`: `lint`, `typecheck`, `test`, `test:coverage`, `build`, `e2e`, `a11y`, database integration workflows, benchmark, and k6 load test. Mobile workflows are defined by `mobile/package.json`.

Evidence: `package.json`, `README.md`, `AGENTS.md`, `.ua/meta.json`, `git diff 55545e7...HEAD -- . ':(exclude).ua/**'`, `lib/db/supabase/timesheets.ts`, `supabase/demo_seed.sql`, and `tests/supabase-repository-authz.test.ts`.
