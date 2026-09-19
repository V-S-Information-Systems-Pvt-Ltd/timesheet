# Architecture Delta

Maintain this file as a small rolling ledger of architecture-affecting changes. Do not copy ordinary implementation churn here.

## 2026-09-19 — C03 exporter review

- `lib/migration/export.ts` now reads schema metadata, entity rows, and committed-receipt-backed provenance in one repeatable-read source transaction. Provenance uses keyset batches and incremental file hashing/size checks rather than loading the full mapping table into memory; the manifest remains the final artifact.
- `lib/migration/providers/session.ts` preserves the transaction callback failure when a dropped connection also prevents rollback, keeping interrupted exports classifiable. The exporter keeps a file-stream error listener while awaiting database batches and reports source values violating known shared destination checks without changing them.
- The C03 PASS claim is suspended pending a disposable live rerun after these fixes and the C06A contract required by the implementation plan. C00 still needs deployment and operator inputs.

## 2026-09-19 — Migration provenance and recovery review

- `lib/migration/matching.ts`, `providers/read.ts`, and `resolutions.ts` treat bundle aliases as review evidence and trust only destination-local mappings joined to committed run receipts, including `publication-intent`.
- `lib/migration/cli.ts` reads the complete planning destination snapshot in a repeatable-read transaction. `lib/migration/schema.ts` binds compatibility to provider-specific schema fingerprints and the paired receipt migrations.
- `lib/migration/merge-plan.ts` rejects duplicate user/date timesheets before apply, matching the database unique index.
- `lib/migration/identity.ts` and `providers/supabase.ts` mark newly created Auth users with the run id, require that marker to reconcile a lost creation response, and recheck it before cleanup. `lib/migration/import.ts` checks a durable receipt after an uncertain SQL commit before any Auth deletion, reads provenance for the planned source namespace during drift checks, and never treats a failed receipt as a completed no-op.
- The current review evidence and remaining disposable live gates are recorded in `docs/plans/SUPABASE_NATIVE_MIGRATION_NOTES.md`; C00 still needs deployment and operator inputs.
- C06B still owns destination-wide fencing/locking: a receipt check alone cannot make Auth cleanup safe against a concurrent apply.

## 2026-09-17 — Maintainability navigation correction

- Corrected the compact context pack to reflect the already-implemented
  `@vsis/client -> @vsis/contracts -> @vsis/core` dependency direction,
  timesheet domain port/composition, native/Supabase adapter pair, and current
  browser `/api/v1/timesheets` read path.
- Added `docs/guides/SAFE_CHANGES.md` with two source-backed navigation drills,
  ownership routing, and focused checks.
- This is documentation and discoverability work against source revision
  `c319473ba02070cc213e6e1a67550ce5811bcf69`; no runtime boundary or public
  contract changed.

## 2026-09-15 — AI retrieval/context infrastructure

- Added the compact `docs/ai-context/` retrieval pack.
- Added Serena project metadata (`.serena/project.yml`) and validated TypeScript symbol/reference lookup.
- Added Atlas orientation tooling and RTK CLI-compaction guidance at the Codex user/tooling layer.
- Kept the existing Understand Anything graph as the semantic/dependency layer.
- No application source or public runtime contract was changed by this setup.

## 2026-09-15 — Registration and live-gate remediation

- Public server-side Supabase registration now uses a fresh anonymous Auth client per operation, fails closed when the provider unexpectedly returns a session, and removes the just-created identity before reporting the configuration failure.
- CI's explicit Supabase live gate now executes both authenticated RLS/restore and registration-confirmation suites with mandatory prerequisites.
- Supabase fixture seeding now whitelists every configured fixture domain before Auth creation; the forward restore migration owns the latest `restore_backup_tx` definition and preserves service-role-only execution.
- The local-only migration-chain repairs are documented as a pre-apply fresh-stack baseline exception; no public route or released response shape changed.

## 2026-09-17 — Security, CI, and release verification hardening

- Added production security-header/CSP coverage and tightened the CI/E2E verification path across `next.config.ts`, `.github/workflows/ci.yml`, `scripts/verify-e2e-fixtures.mjs`, `supabase/config.toml`, and their tests.
- Added the signing-key export/fixture boundary used by deterministic verification; secret material remains environment/configuration scoped rather than part of application DTOs.
- These changes affect deployment and verification boundaries but do not change the stable web, mobile, or repository response contracts.

## 2026-09-17 — Team-scope RPC contract correction

- `lib/db/supabase/timesheets.ts` now calls `public.team_ids(target)` with the function's actual argument name, preserving leader self-plus-subordinates scoping.
- `supabase/demo_seed.sql` uses the same `target uuid` signature and `tests/supabase-repository-authz.test.ts` covers the success and RPC-error paths.
- This is an authorization-scoped persistence correction: native/Supabase parity and the repository contract remain unchanged.

## Current evidence status

The context pack in the working tree is current through `c319473ba02070cc213e6e1a67550ce5811bcf69`. Understand Anything's existing graph remains preserved and structurally valid, but its metadata baseline is `55545e77b7b655b0f72e0b5d889ee61ada6d87e7`; refresh it incrementally before using graph relationships for files changed after that baseline.

## Current architecture baseline

The baseline remains the dual-backend architecture described in `docs/architecture/AI_ARCHITECTURE_CONTEXT.md` and enforced by `AGENTS.md`: backend-neutral auth/repository facades, web + versioned mobile HTTP surfaces, two role axes, paired migration tracks, and native/Supabase authorization parity.

## Update rule

Add an entry when a change alters a major boundary, public contract, persistence/auth model, deployment topology, cross-package compatibility surface, or invariant in `CONSTRAINTS.md`. Include the source paths and any ADR/reference that explains the decision.
