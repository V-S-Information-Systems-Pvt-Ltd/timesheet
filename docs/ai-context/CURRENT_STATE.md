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

- Understand Anything graph: `.ua/knowledge-graph.json`; metadata analysis commit `eb1b759e37481dd24aff978606ac3d2d637e8639`.
- Freshness check at pack creation: no committed non-`.ua` source differences from that analysis commit to current HEAD. The hash difference alone is therefore not treated as source staleness.
- Atlas: available as `atlas`; use a 2k-token map first for unfamiliar work.
- Serena: project config in `.serena/project.yml`, TypeScript LSP; symbol/reference lookup validated.
- RTK: available as `rtk`; use it for noisy supported CLI commands where full raw output is not required.

## Current architecture issues / unknowns

No new active architecture defect is asserted by this setup task. The material unresolved operational unknowns are environment-specific: which migration versions are applied to each deployed database, production proxy/secret values, and whether future repository migration files have been deployed. Resolve those from the target environment rather than inferring them from Git.

## Last meaningful architecture update

The shared package/domain/adapter modularization predates this documentation
correction. This task updates navigation facts against source revision
`c319473ba02070cc213e6e1a67550ce5811bcf69`; it does not deliver new runtime
modularization or a public contract change.

## Working-tree note

Before this setup task, `.ua/intermediate/` was already untracked. Preserve it unless a separate task explicitly owns it.

## Verification entry points

Root scripts are authoritative in `package.json`: `lint`, `typecheck`, `test`, `test:coverage`, `build`, `e2e`, `a11y`, database integration workflows, benchmark, and k6 load test. Mobile workflows are defined by `mobile/package.json`.

Evidence: `package.json`, `README.md`, `AGENTS.md`, `.ua/meta.json`, `git diff eb1b759...HEAD -- . ':(exclude).ua/**'`.
