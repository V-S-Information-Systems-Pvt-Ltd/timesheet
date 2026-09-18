# Current State

Snapshot date: 2026-09-17. Source revision at correction: `c319473ba02070cc213e6e1a67550ce5811bcf69`.

## Purpose and direction

VSIS Timesheet is a web + mobile time-entry, leave/reminder, reporting, and administration system. Its current architectural direction is to keep one application/domain contract portable across two backend modes while preserving web/mobile behavior and authorization parity.

## Product/runtime

- Web: Next.js 16 App Router (`next` `^16.3.0`) with React 19.2.4.
- Mobile: standalone React Native application under `mobile/` for Android, iOS, and Windows.
- Shared packages: `@vsis/core` for platform-neutral calculations and validation,
  `@vsis/contracts` for canonical schemas/types/DTOs, and `@vsis/client` for
  typed HTTP operations. The root workspace covers `packages/*`; mobile consumes
  all three through local file dependencies.
- Backend selection: `NEXT_PUBLIC_BACKEND` chooses `supabase` (default) or `native` at build time.
- Supabase mode: Supabase Auth + Postgres/PostgREST/RLS.
- Native mode: in-app email/password auth + signed session cookies + self-hosted PostgreSQL.
- Deployment: Vercel for Supabase mode; standalone/container flow for native mode via `Dockerfile`, Docker Compose, and `deploy/` manifests.

## Stable boundaries

- Server identity: `lib/auth/index.ts` facade.
- Browser identity/data: `lib/auth/client.ts` and `lib/data/client.ts`.
- Persistence: `lib/db/repository.ts` contract; `lib/db/index.ts` dispatches to native or Supabase adapters.
- Web HTTP guards: `app/api/_http.ts`.
- Mobile HTTP guards: `app/api/v1/_http.ts`.
- Server Actions: public surface re-exported by `app/actions.ts`, implementations in `app/actions/`.
- Timesheet application slice: web actions and `/api/v1` services call
  `lib/domain/timesheets.ts`, which receives `TimesheetPersistence` through
  `lib/db/timesheets.ts`; native and Supabase adapters implement that port.
- Contract/mapping slice: `packages/contracts` owns the wire shape,
  `lib/api/v1/contracts.ts` maps server rows to DTOs, and browser/mobile clients
  consume the same released shape.
- Schema: additive native migrations in `db/migrations/`; additive Supabase migrations in `supabase/migrations/`.

## Repository intelligence

- Understand Anything graph: `.ua/knowledge-graph.json`; metadata analysis commit `55545e77b7b655b0f72e0b5d889ee61ada6d87e7`.
- Structural validation on 2026-09-17 found 1,867 nodes, 3,601 edges, 10 layers, and 9 tour steps with no dangling edge, layer, or tour references. The graph is stale relative to the current source: 84 non-`.ua` files differ from its metadata commit. Treat it as navigation evidence only until an incremental refresh is run.
- Atlas: available as `atlas`; use a 2k-token map first for unfamiliar work.
- Serena: project config in `.serena/project.yml`, TypeScript LSP; symbol/reference lookup validated.
- RTK: available as `rtk`; use it for noisy supported CLI commands where full raw output is not required.

## Current architecture issues / unknowns

No new active architecture defect is asserted by this setup task. The material unresolved operational unknowns are environment-specific: which migration versions are applied to each deployed database, production proxy/secret values, and whether future repository migration files have been deployed. Resolve those from the target environment rather than inferring them from Git.

## Last meaningful architecture update

The shared package/domain/adapter modularization predates this documentation
correction. Current HEAD is `c319473` (`fix(timesheets): use target parameter for
team_ids RPC subordinate lookup`, 2026-09-17); that change corrects the Supabase
subordinate lookup argument, aligns the demo seed function signature, and adds
leader-scope/error-path coverage. This task updates navigation facts against the
current source and does not deliver new runtime modularization or a public
contract change.

## Working-tree note

`.ua/` is ignored local Understand Anything state. Preserve its graph, metadata, fingerprints, and any intermediate diagnostics unless a separate task explicitly owns a refresh or cleanup.

## Verification entry points

Root scripts are authoritative in `package.json`: `lint`, `typecheck`, `test`, `test:coverage`, `build`, `e2e`, `a11y`, database integration workflows, benchmark, and k6 load test. Mobile workflows are defined by `mobile/package.json`.

Evidence: `package.json`, `README.md`, `AGENTS.md`, `.ua/meta.json`, `git diff 55545e7...HEAD -- . ':(exclude).ua/**'`, `lib/db/supabase/timesheets.ts`, `supabase/demo_seed.sql`, and `tests/supabase-repository-authz.test.ts`.
