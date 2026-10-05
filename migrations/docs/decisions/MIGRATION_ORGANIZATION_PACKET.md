# Migration file organization — 2026-10-05

## Decision

Centralize operator code, runbooks, evidence and captured rehearsal helpers in
`migrations/`. Keep application schema migrations at `db/migrations/` and
`supabase/migrations/`, as explicitly confirmed by the operator.

## Evidence and constraints

- FACT: `package.json`, `tsconfig.json`, ESLint, CI, boundary tests and OpenShift
  packaging refer to the private migration workspace.
- FACT: its Vitest config and imports resolve the repository two levels above
  the workspace. `migrations/tool/` preserves that depth.
- FACT: `journal.ts` stores journals relative to the invocation directory.
  Preserve workspace journals there; retain former root journals separately.
- FACT: captured C08 scripts are machine/run-specific and reference private
  temporary backups. Moving them does not authorize replay or production work.
- UNKNOWN: private backup availability at a future cutover. Revalidate then.

## Alternatives and lifecycle

Retaining scattered operator files leaves root clutter. Moving schema paths
would change application/Supabase tooling contracts unnecessarily. The chosen
layout keeps one implementation, updates active consumers and local links, and
preserves immutable capture outputs. Local journals, bundles and raw reports
stay ignored. No retries, recovery transitions or concurrency behavior change.
No migration, cluster operation or production writer control is executed.

## Acceptance

Workspace discovery, CLI help, boundary tests, migration tests, types/lint,
both application builds and link checks must pass. Review staged filenames and
contents before committing; preserve private operational state outside Git.
