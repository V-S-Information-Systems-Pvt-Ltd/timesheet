# Architecture Delta

Maintain this file as a small rolling ledger of architecture-affecting changes. Do not copy ordinary implementation churn here.

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

## Current architecture baseline

The baseline remains the dual-backend architecture described in `docs/architecture/AI_ARCHITECTURE_CONTEXT.md` and enforced by `AGENTS.md`: backend-neutral auth/repository facades, web + versioned mobile HTTP surfaces, two role axes, paired migration tracks, and native/Supabase authorization parity.

## Update rule

Add an entry when a change alters a major boundary, public contract, persistence/auth model, deployment topology, cross-package compatibility surface, or invariant in `CONSTRAINTS.md`. Include the source paths and any ADR/reference that explains the decision.
