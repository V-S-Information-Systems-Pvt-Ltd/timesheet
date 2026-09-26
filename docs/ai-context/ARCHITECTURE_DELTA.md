# Architecture Delta

## 2026-09-26 — Local Supabase logical backup

- `scripts/backup-supabase.mjs` / `npm run db:backup` provide an operator-only, read-only export using the installed CLI, pinned to the live Supabase project `bcsdqkjzobllocejfcdz` with no local/native/source-selection fallback. Run folders default to `C:\dev\db-backup`, are private before export, and are published only after all SQL files and checksums succeed; failed/interrupted runs remain `.partial`.
- Roles, application schema/data, migration history and an Auth/Storage schema reference are captured separately. This is not an application JSON backup, provider fence, data transfer, shared-snapshot export, or verified recovery rehearsal; platform secrets/configuration and Storage object files remain out of scope.

## 2026-09-23 — Fresh queued-work admission after migration

- Reference-free mobile creates from a remapped actor use a destination-local, server-minted idempotency key bound to actor, operation, 97-day expiry, and the current durable fence generation (`lib/idempotency-fresh-key.ts`, paired `0037`/`20261005000000` migrations). The mobile queue persists a key only on a newly enqueued item; existing keys and manual-review records are never retrofitted.
- Imported/local retry history is checked first. A reference-free create proceeds through the ordinary atomic idempotency claim only when its key matches the current admitted generation; legacy, expired, forged, or wrong-actor keys still require review (`lib/idempotency.ts`). An updated mobile client is required; the live C07 matrix and deferred C08 rehearsal remain open.

Maintain this file as a small rolling ledger of architecture-affecting changes. Do not copy ordinary implementation churn here.

## 2026-09-22 — Migration write-admission hardening remains partial

- Apply fails closed on a missing write-gate table or row before identity/data mutation and rechecks the fenced row under transaction lock. Completed receipts replay read-only while validating durable evidence and reporting row drift; data-committed promotion still needs a fence (`lib/migration/gate.ts`, `lib/migration/import.ts`).
- Server Actions now separate active/role/super-admin read checks from explicit fail-closed mutating wrappers (`app/actions/_shared.ts` and action transports).
- The provider fence records a versioned digest-bound inventory artifact and verifies SQL/REST denial more strictly, but remains a **partial DML privilege primitive**. It does not stop Supabase Auth/admin, jobs, integrations, ingress, or existing connections; C00/C07/C08 retain those gates.

## 2026-09-21 — Migration provenance identity and recovery hardening

- Supabase durable database namespaces now always use the verified project reference when available; `pg_control_system()` remains the native/no-project-reference fallback. Direct and restricted/pooler roles therefore cannot split one Supabase database's receipts and mappings into different provenance namespaces (`lib/migration/providers/session.ts`).
- The adopted C06A rule now classifies never-committed queued payloads from server-owned mappings: fully source-era payloads are translated, destination-era payloads proceed unchanged, and mixed/ambiguous payloads require review. This supersedes the unresolved statement in the 2026-09-20 entry.
- The development recovery harness now injects dropped Auth responses, lost SQL commit responses, unreadable post-commit receipts, failed identity-journal writes, source Auth/profile inconsistencies, and unrelated destination drift after provisioning. The identity cases capture real Supabase Auth/profile facts through the migration read boundary and guard against any destination Auth/write mutation. Gate snapshot/fencing is row-locked and teardown restores the exact pre-test state only while the row is still suite-owned; a concurrent operator transition is preserved and fails the suite. The current revision passed all seven cases against the loopback Docker/Supabase stack, closing the C02/C04/C05 evidence gate without making a production claim (`tests/migration-recovery.int.test.ts`, migration execution notes).
- Free-form migration diagnostics redact connection strings, bearer credentials, JWTs, inline secret fields and Supabase key formats before CLI output or journaling (`lib/migration/journal.ts`).

## 2026-09-20 — Migration receipts, dispositions and portable retry evidence

- Migration bundles now carry digest-bound `retry-history.json` facts for the eight queued mobile mutations. Apply stores them in protected `migration_retry_history` tables in both backend tracks, alongside complete durable record dispositions.
- Runtime idempotency lookup evaluates destination-local and imported histories together and replays only one exact committed fingerprint. Conflicts, uncertain results and equal matches across namespaces return 409; requests containing a known remapped source id also fail closed.
- Never-committed queued work still lacks authenticated source namespace/timestamp context, so safe forward ID translation is unresolved. C03/C06A remain blocked rather than claiming the portable strategy complete.
- Apply persists `verified` only after rows, mappings, dispositions and retry history reconcile. Publication intent now requires `verified`.

## 2026-09-19 — C04 identity review

- The migration bundle gained a digest-bound, optional `identities.json` (`lib/migration/format.ts`, `export.ts`, `validation.ts`): the source's sign-in providers and second-factor counts (plus native credential presence) are captured under the export snapshot and bound into a reviewed plan's `snapshot.sourceIdentities`. The plan's existing `snapshot.identities` remain destination facts used for matching and drift.
- `lib/migration/identities.ts` reads only the source inventory, fails closed (`E_IDENTITY_INVENTORY_MISSING`) when a provisioned account has no captured facts, and blocks a referenced profile that the merged result does not contain (`E_HISTORICAL_UNRESOLVED`) instead of failing later as an FK orphan.
- `lib/migration/import.ts` reports the journaled provisioning outcomes and removes only run-created accounts when a provisioning pass fails; `deploymentSnapshotDigest` now binds destination provider identities and MFA factors; `providers/read.ts` probes `auth.mfa_factors` with `to_regclass` so the compatibility fallback cannot abort the planning transaction.
- At that review point C04's PASS was suspended pending a live rerun. That historical suspension was resolved by the seven-case loopback Supabase recovery run on 2026-09-21; current evidence and remaining gates are recorded in `docs/plans/SUPABASE_NATIVE_MIGRATION_NOTES.md`.

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

## 2026-09-23 — Migration publication/fence generation binding

- `lib/migration/publish.ts` now requires the locked destination gate to be fenced for the receipt's run and namespace before verification, intent, or admission; a stale receipt cannot admit a later run.
- `lib/migration/gate.ts` retains a UUID per fenced window, refuses a new generation for a run with a durable receipt, and permits explicit recovery opening only for the matching locked run before publication intent. Normal admission stays atomic in `publish --phase admit` (`lib/migration/cli.ts`).
- Provider grant inventory and revocation now share the gate-row lock in one transaction (`lib/migration/cli.ts`, `lib/migration/providers/fence.ts`). Both migration ledgers require the gate-generation migrations (`lib/migration/schema.ts`). This hardens the migration control plane but does not replace deployment-wide writer shutdown or live C06B/C08 proof.

## Current evidence status

The context pack in the working tree is current through `c319473ba02070cc213e6e1a67550ce5811bcf69`. Understand Anything's existing graph remains preserved and structurally valid, but its metadata baseline is `55545e77b7b655b0f72e0b5d889ee61ada6d87e7`; refresh it incrementally before using graph relationships for files changed after that baseline.

## Current architecture baseline

The baseline remains the dual-backend architecture described in `docs/architecture/AI_ARCHITECTURE_CONTEXT.md` and enforced by `AGENTS.md`: backend-neutral auth/repository facades, web + versioned mobile HTTP surfaces, two role axes, paired migration tracks, and native/Supabase authorization parity.

## Update rule

Add an entry when a change alters a major boundary, public contract, persistence/auth model, deployment topology, cross-package compatibility surface, or invariant in `CONSTRAINTS.md`. Include the source paths and any ADR/reference that explains the decision.
