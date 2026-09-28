# Architecture Delta

## 2026-09-28 — OpenShift CRC TEST deployment topology added and verified

- `deploy/openshift/` now owns a filtered OpenShift binary-build path, a CRC-only persistent PostgreSQL Deployment, reusable application/Route/CronJob/NetworkPolicy manifests, a separately controlled bootstrap seed Job, and secret-safe persistence smoke Jobs. Runtime application code and public HTTP contracts are unchanged.
- The TEST topology is native-only: project-local `vsis-timesheet:crc`, one app replica, one `Recreate` PostgreSQL replica with a CRC hostpath PVC, edge-TLS Route `timesheet-test.apps-crc.testing`, `TRUSTED_PROXY_HOPS=1`, restricted SCC/arbitrary UID operation, and separate runtime/bootstrap Secrets. The bootstrap password is not injected into the long-running application Deployment.
- Build `vsis-timesheet-4` published digest `sha256:565f041977eb6a318247ccf9af42c81e391265e531606d8f111d2c266a27ac1b` from the dirty `arch/architecture-simplification` worktree at HEAD `d9f8b80aaafac1ffdc343d1b1d480544dd588cb9`; this is TEST provenance rather than release provenance. The filtered source context excludes environment/credential-like files and includes the migration workspace required by `npm ci`.
- Live CRC verification passed: PostgreSQL and app Ready; app pod `restricted-v2` with arbitrary UID `1000650000`; 37/37 migration ledger rows have checksums; seed completed; HTTPS liveness/readiness and HSTS passed with HTTP redirect; authenticated create/read survived an app restart and a separate PostgreSQL pod replacement and was cleaned up; the protected cleanup CronJob completed as a one-off Job.
- CRC disk pressure during image builds evicted the hostpath CSI DaemonSet as well as PostgreSQL. Recovery preserved the PVC: after pressure cleared, the failed CSI pod was recreated to 4/4 Ready, PostgreSQL remounted the retained volume, and persistence verification passed. This reinforces that CRC storage/build resources are TEST-only; production still requires approved HA/managed PostgreSQL, backups plus restore verification, trusted TLS, rotated Secrets, immutable release provenance, capacity planning, and an explicit cutover/rollback plan.

## 2026-09-27 — Phase 4 retirement evidence capture added without retirement authority

- The private migration package adds `retirement-inventory`, an operator-only command combining a strict deployment/client/capability declaration with aggregate evidence from one repeatable-read database snapshot. Connections remain explicit `MIGRATION_*` variables; no application runtime import or fallback exists.
- Required migration relations/columns and complete row visibility are verified before capture. Output is canonical, digest-bound, exclusive and aggregate-only: no run IDs, source namespaces, record/ticket/actor/resource IDs, payload fingerprints, endpoints, credentials or record bodies are emitted. Unknown/stale declarations produce a completed blocked artifact; missing/incompatible/unreadable database evidence or identity mismatch produces no artifact.
- Retained fresh-key rows are reported by operation and expiry/generation bucket only. They do not prove pending work, consumption, offline queues or future issuance. The artifact fixes its purpose to `evidence-only` and its gate assessment to `not-performed`; it cannot satisfy or authorize R1–R3, C08–C10, cutover, cleanup, teardown or provider retirement.
- `docs/plans/SUPABASE_RETIREMENT_PLAN.md` records the declaration template, command, artifact semantics, per-deployment checklist and still-open gate ledger. No live deployment inventory has been performed.
- Verification passed: the focused retirement-inventory suite (5 tests), the complete migration package suite (333 tests passed, 26 environment-gated tests skipped), migration coverage gates (80.44% statements, 70.01% branches, 81.27% functions and 81.91% lines), migration lint and TypeScript, and application boundary enforcement (13 tests). Live deployment capture was not run because no direct target database URL was supplied; Docker was unavailable for this evidence-only slice.

## 2026-09-26 — Phase 3 browser transport consolidation completed in source

- All production browser data/authentication calls, dashboard Server Action consumers and raw application fetches now flow through `lib/auth/client.ts` or `lib/data/client.ts` to `/api/v1`. New browser resources cover web layouts/capabilities, branding, superadmin reset/user/whitelist/title/activity lifecycle, CSV import, backup export/restore and per-user timesheet deletion. Cookie-specific adapters acknowledge action-style writes without imposing bearer/mobile read-backs.
- `lib/import-timesheets.ts` now owns CSV reference resolution, row validation, 24-hour cap enforcement and the daily-import reservation for both the rollback action and v1 route. Rejected/failed/exceptional attempts release the reservation; successful provider imports retain the charge. `lib/audit.ts` similarly preserves transport-owned best-effort audits for rollback actions and superadmin HTTP coordinators.
- Browser activity deletion remains superadmin-only despite the shared mobile/admin domain policy. Branding preserves root-layout invalidation and explicit current-page refresh. Backup export remains an admin read during write fences; restore remains bounded and atomic. Existing bearer DTOs, mobile idempotency/retry behavior, provider auth/recovery and migration compatibility are unchanged.
- Boundary enforcement now rejects browser imports of Server Actions and legacy `/api/data/*` or `/api/auth/*` URLs, and rejects v1/shared browser endpoints that depend on legacy route or action modules. CSRF origin validation now lives in neutral `lib/http/origin.ts`; the branding-logo preview resolves auth directly through the auth facade. Source caller-zero is proven; legacy server aliases remain deployable solely for rollback until deployment observation confirms no old consumers. This is not authorization to remove provider auth, write fences, portable retry/tickets, migration tools/state or applied migrations.
- Closure verification passed: 141 application test files and 1,601 tests passed, with 13 environment-gated files/60 tests skipped. Coverage passed at 72.17% statements, 63.59% branches, 79.09% functions and 75.72% lines. Lint, TypeScript, focused retirement-boundary regressions, and CI-equivalent Supabase/native production builds passed. Live database/provider-auth, Docker and Playwright checks were not rerun for this transport-only closure; earlier Phase 1/2 database evidence remains unchanged.

## 2026-09-26 — Browser own-profile editing moved to the versioned profile resource

- `MyProfilePanel` now uses `lib/data/client.ts` to submit department/title changes to strict cookie-enabled `PATCH /api/v1/profile`. The route calls the same `updateOwnProfileDomain` operation as the rollback Server Action, preserving trim/clear behavior, title-to-hierarchy validation and authenticated self-only persistence. The response acknowledges the write without a read-back; separate submissions are neither coalesced nor automatically retried.
- Profile read/write policy remains intentionally asymmetric: `GET /api/v1/profile` permits a signed-in inactive account to read its profile, while PATCH requires an active actor, same origin and an open write fence. Explicit bearer credentials do not fall back to cookies. Mobile `/api/v1/auth/me` retains its partial-input and actor-DTO response contract, and title reads remain in the later reference/activity-title slice.
- Verification: eight focused suites passed (99 tests); the settled application coverage run passed 135 files and 1,535 tests, with 13 environment-gated files/60 tests skipped. Coverage gates passed (71.33% statements, 63.10% branches, 78.17% functions, 74.89% lines), along with lint, TypeScript and native/Supabase production builds. Tests cover active/inactive separation, anonymous/origin/bearer/fence refusal, strict input, self scope, trimming/clears, hierarchy-title mismatch, provider errors, no read-back/coalescing and mobile regressions. Supabase compilation used CI-equivalent placeholders with its live Auth-config gate skipped. Live database/provider-auth, Docker and Playwright checks were not rerun for this transport-only slice.
- Next open Phase 3 row: activity-type mutations. Other administrative/settings/import-export slices and explicit legacy retirement remain open in the transport matrix. The prior architecture checkpoint is committed as `d9f8b80`; this own-profile slice remains reviewable and uncommitted.

## 2026-09-26 — Browser user administration moved to versioned resources

- Add-user, whitelist/user-panel and hierarchy-editor callers now use `lib/data/client.ts` for creation, status toggles, role/name/department/manager and hierarchy changes. Existing `/api/v1/admin/users` route files explicitly admit cookies under the shared active/origin/fail-closed-fence guard; permission-role admin is required independently of legacy/hierarchy roles. Explicit bearer credentials never fall back to cookies, and cookie access remains independent of the mobile feature switch.
- `packages/contracts/src/browser-users.ts` defines strict cookie create and discriminated mutation contracts. `lib/api/v1/services/browser-users.ts` delegates to the same narrow people-domain operations as the old actions, preserving current-server-state toggles, unconditional self-role/reporting-line guards, title-derived hierarchy, cycle rules, clear values, credential wording and operation-specific best-effort audits. Browser writes acknowledge completion without adding a read-back; mobile defaults, generic atomic updater and user DTO responses are unchanged. Separate browser writes are not coalesced or automatically retried.
- The seven user-administration actions remain rollback. Their components still use legacy title reads and user-timesheet deletion, owned by later settings/import-export slices; those transports are not retired. No provider, schema, budget, concurrency protocol, commit or deployment changed.
- Verification: seven focused suites passed (120 tests); the settled application coverage run passed 134 files and 1,516 tests, with 13 environment-gated files/60 tests skipped. Coverage gates passed (71.29% statements, 63.04% branches, 78.18% functions, 74.86% lines), along with lint, TypeScript, both native/Supabase production builds and CRLF-aware diff whitespace checking. Tests cover all operations, field mapping, no read-back, audits, title/cycle/self rules, origin-before-identity, closed/unreadable fences and bearer/mobile regression. Supabase compilation used CI-equivalent placeholders with its live Auth-config gate skipped. Live database/provisioning/provider-auth, Docker and Playwright checks were not rerun for these new transports.
- Next open Phase 3 row: own-profile editing. Other administrative/settings/import-export slices and explicit legacy retirement remain open in the transport matrix.

## 2026-09-26 — Browser project administration moved to versioned resources

- `ProjectManager` now uses `lib/data/client.ts` for add, rename, S.O. number, Telegram number and delete instead of importing Server Actions. The two existing `/api/v1/admin/projects` route files explicitly admit browser cookies; domain policy still requires an active admin/PM permission role independently of hierarchy/legacy roles. Origin-before-identity, bearer non-fallback and fail-closed write fencing remain in the shared guard.
- Browser create preserves the action's name-only domain call. `updateProjectFields` shares the original ordered field writes while allowing browser PATCH to acknowledge completion without a post-write read-back. Mobile/bearer PATCH still reads back and returns its project DTO. The existing manager refresh callback, normalization/clear values, positive-integer Telegram validation, duplicate-name/dependency failures and action rollback paths remain unchanged; direct submissions are neither coalesced nor automatically retried. Cookie patch structure rejects malformed optional-field types rather than silently clearing them.
- Verification: six focused suites passed (124 tests); the settled application coverage run passed 133 files and 1,482 tests, with 13 environment-gated files/60 tests skipped. Coverage gates passed (71.06% statements, 62.78% branches, 77.98% functions, 74.64% lines), alongside lint, TypeScript and native/Supabase production builds. Supabase compilation used CI-equivalent placeholders with the live Auth-config check skipped. No live database/provider-auth/Docker/Playwright checks were rerun for this slice; no schema, provider adapter, commit or deployment changed.
- Phase 3 remains partial: user/profile, activity types, global reminders, settings/branding/superadmin and import/export action slices, plus explicit legacy retirement, remain open in the transport matrix.

## 2026-09-26 — Browser timesheet actions moved to versioned resources

- Time-entry/backfill forms and the entries table now use `lib/data/client.ts` for create, yesterday, update, delete, duplicate and undo-last operations. Dedicated `/api/v1/timesheets/yesterday` and `/last` routes resolve the date/latest target on the server and preserve the existing domain/persistence path. Validation retains field errors and the browser adapter preserves action-facing resource messages.
- The bulk-edit modal now calls `POST /api/v1/timesheets/batch-update`, using the canonical 1–500-row contract in `packages/contracts`. Transport bounds are checked before budget reservation; row-value validation remains in the existing domain. Mixed results preserve `updated/errors`; all-failed results retain row details and the browser's `All edits failed.` message. The domain charges once and releases when no rows update or storage throws.
- Cookie writes retain origin-before-identity, active-account and fail-closed write-fence gates. Explicit bearer credentials never fall back to cookies. Browser submissions remain separate, direct writes: no single-flight coalescing, invented idempotency keys or automatic delayed retries. Existing mobile keyed-write behavior and the old Server Actions remain unchanged for rollback.
- Settled verification: 132 application test files passed, 13 environment-gated files skipped; 1,445 tests passed, 60 skipped. Coverage gates passed (70.87% statements, 62.36% branches, 77.85% functions, 74.50% lines), as did lint, TypeScript, native and Supabase production builds, and CRLF-aware diff whitespace checking. Focused tests include one-charge/refund, mixed/all-failed outcomes, batch bounds, ownership, origin/inactive/explicit-bearer refusal, and closed/unreadable write fences. Supabase compilation used CI-equivalent placeholder settings with its live Auth-config gate skipped. Live database, provider-auth, Docker and Playwright checks were not rerun for this transport-only slice; earlier evidence does not constitute verification of these new transports.
- Phase 3 is still partial: project/user/settings/superadmin/import-export action migrations and explicit legacy retirement remain open in `PHASE3_TRANSPORT_CONTRACT_MATRIX.md`. No schema, backend retirement, commit or deployment was performed.

## 2026-09-26 — Browser authentication moved behind versioned transports

- Native browser login, logout, session, signup, domain-check, forgot/reset-password and password-change callers now use explicit `/api/v1/auth/browser/*` routes. The legacy `/api/auth/*` endpoints remain available during the rollback window, but both route families export the same neutral browser handlers so their cookie, origin, rate-limit, signed-in-only and recovery contracts cannot drift independently.
- Existing mobile bearer endpoints under `/api/v1/auth/*` retain their token/session semantics and mobile feature flag. Browser login/registration is explicitly independent of that flag. Supabase provider login/logout/recovery/password operations remain direct SDK calls because their provider callback/session semantics are intentionally retained; only the application-owned two-phase mobile-session revocation moved to `/api/v1/auth/browser/revoke-mobile-sessions`.
- Focused verification passed across 14 auth/registration/recovery/mobile suites (137 tests) plus project TypeScript checking. Legacy/v1 browser aliases are also asserted structurally during the rollback window.

## 2026-09-26 — Migration tooling and portable-retry isolation

- Operator migration source and its test suite moved from application-owned paths into the private `@vsis/migration-tool` workspace (`tools/migration/src/`, `tools/migration/tests/`). `npm run migration` remains the root operator entry point, while dedicated package lint, type, unit/integration, and coverage gates now run in their own CI job.
- Request-time imported-history resolution, local-history precedence, replay authorization, namespace refusal, payload classification/translation, and fresh-key admission moved into `lib/idempotency/portable-retry.ts`. Ordinary local ledger/effect handling remains in `lib/idempotency.ts` and is supplied through explicit callbacks, preserving the application/operator dependency direction.
- Boundary tests forbid application imports of `@vsis/migration-tool` or `tools/migration`; root application coverage continues to own runtime retry compatibility. No schema, public API, migration behavior, or retirement decision changed. Operator tooling remains gated by R2; runtime retry state/readers remain gated by R1 and the relevant R2/R3 obligations.

## 2026-09-26 — Broad repository facade retired

- Shared actor, result, input, and report contracts now live in `lib/db/types.ts`. The aggregate `Repository` interface and `lib/db/{index,native,supabase}.ts` facades were removed.
- `lib/rate-limit.ts` lazy-loads `lib/db/rate-limits.ts`, which selects the active provider's existing operations adapter for reserve/release. Both provider implementations and the limiter's fallback/refusal policy remain unchanged.
- Former facade tests now call their owning provider adapters directly, including registration's whitelist lookup. Authorization assertions remain in place, and a repo-wide boundary test prevents the removed facade imports from returning.
- The architecture context pack, contributor guidance, and current architecture references now describe narrow domain ports and composition modules as the persistence boundary.
- Verification passed: project typecheck and lint; the complete coverage run (141 files passed, 18 environment-gated files skipped; 1,714 tests passed, 86 skipped; 73.78% statements, 64.58% branches, 78.47% functions, 76.76% lines); the remote Supabase retry-history integration suite (3 tests, cleanup verified); the live Supabase Auth configuration gate; and both Supabase and native production builds. The Supabase checks used the external test-project settings from `C:/dev/timesheet-dual-backend-modular/.env.test`. A disposable local PostgreSQL 16 Docker container passed the native database suites (10 files, 48 tests), migration export (7 tests), C06B write-fence (3 tests), native provider-fence (8 tests; its Supabase leg skipped), and deployed-schema upgrade path (1 test). The container and all test data were removed afterward. Playwright and Supabase-specific live database/migration legs were not run because they require a seeded browser server or a local Supabase stack/direct Supabase database URL, not plain PostgreSQL alone.

## 2026-09-26 — Native destination decision recorded

- `docs/ai-context/ADR_NATIVE_DESTINATION.md` and the C00 ledger record Supabase → native as the first production direction, with native surviving. This closes only the direction question; C00 operational inputs, original-provider recovery, C06B/C07/C08, and C09/C10 gates remain open. No runtime or deployment behavior changed.

## 2026-09-26 — Local Supabase logical backup

- `scripts/backup-supabase.mjs` / `npm run db:backup` provide an operator-only, read-only export using the installed CLI, pinned to the live Supabase project `bcsdqkjzobllocejfcdz` with no local/native/source-selection fallback. Run folders default to `C:\dev\db-backup`, are private before export, and are published only after all SQL files and checksums succeed; failed/interrupted runs remain `.partial`.
- Roles, application schema/data, migration history and an Auth/Storage schema reference are captured separately. This is not an application JSON backup, provider fence, data transfer, shared-snapshot export, or verified recovery rehearsal; platform secrets/configuration and Storage object files remain out of scope.

## 2026-09-23 — Fresh queued-work admission after migration

- Reference-free mobile creates from a remapped actor use a destination-local, server-minted idempotency key bound to actor, operation, 97-day expiry, and the current durable fence generation (`lib/idempotency-fresh-key.ts`, paired `0037`/`20261005000000` migrations). The mobile queue persists a key only on a newly enqueued item; existing keys and manual-review records are never retrofitted.
- Imported/local retry history is checked first. A reference-free create proceeds through the ordinary atomic idempotency claim only when its key matches the current admitted generation; legacy, expired, forged, or wrong-actor keys still require review (`lib/idempotency.ts`). An updated mobile client is required; the live C07 matrix and deferred C08 rehearsal remain open.

Maintain this file as a small rolling ledger of architecture-affecting changes. Do not copy ordinary implementation churn here.

## 2026-09-22 — Migration write-admission hardening remains partial

- Apply fails closed on a missing write-gate table or row before identity/data mutation and rechecks the fenced row under transaction lock. Completed receipts replay read-only while validating durable evidence and reporting row drift; data-committed promotion still needs a fence (`tools/migration/src/gate.ts`, `tools/migration/src/import.ts`).
- Server Actions now separate active/role/super-admin read checks from explicit fail-closed mutating wrappers (`app/actions/_shared.ts` and action transports).
- The provider fence records a versioned digest-bound inventory artifact and verifies SQL/REST denial more strictly, but remains a **partial DML privilege primitive**. It does not stop Supabase Auth/admin, jobs, integrations, ingress, or existing connections; C00/C07/C08 retain those gates.

## 2026-09-21 — Migration provenance identity and recovery hardening

- Supabase durable database namespaces now always use the verified project reference when available; `pg_control_system()` remains the native/no-project-reference fallback. Direct and restricted/pooler roles therefore cannot split one Supabase database's receipts and mappings into different provenance namespaces (`tools/migration/src/providers/session.ts`).
- The adopted C06A rule now classifies never-committed queued payloads from server-owned mappings: fully source-era payloads are translated, destination-era payloads proceed unchanged, and mixed/ambiguous payloads require review. This supersedes the unresolved statement in the 2026-09-20 entry.
- The development recovery harness now injects dropped Auth responses, lost SQL commit responses, unreadable post-commit receipts, failed identity-journal writes, source Auth/profile inconsistencies, and unrelated destination drift after provisioning. The identity cases capture real Supabase Auth/profile facts through the migration read boundary and guard against any destination Auth/write mutation. Gate snapshot/fencing is row-locked and teardown restores the exact pre-test state only while the row is still suite-owned; a concurrent operator transition is preserved and fails the suite. The current revision passed all seven cases against the loopback Docker/Supabase stack, closing the C02/C04/C05 evidence gate without making a production claim (`tools/migration/tests/migration-recovery.int.test.ts`, migration execution notes).
- Free-form migration diagnostics redact connection strings, bearer credentials, JWTs, inline secret fields and Supabase key formats before CLI output or journaling (`tools/migration/src/journal.ts`).

## 2026-09-20 — Migration receipts, dispositions and portable retry evidence

- Migration bundles now carry digest-bound `retry-history.json` facts for the eight queued mobile mutations. Apply stores them in protected `migration_retry_history` tables in both backend tracks, alongside complete durable record dispositions.
- Runtime idempotency lookup evaluates destination-local and imported histories together and replays only one exact committed fingerprint. Conflicts, uncertain results and equal matches across namespaces return 409; requests containing a known remapped source id also fail closed.
- Never-committed queued work still lacks authenticated source namespace/timestamp context, so safe forward ID translation is unresolved. C03/C06A remain blocked rather than claiming the portable strategy complete.
- Apply persists `verified` only after rows, mappings, dispositions and retry history reconcile. Publication intent now requires `verified`.

## 2026-09-19 — C04 identity review

- The migration bundle gained a digest-bound, optional `identities.json` (`tools/migration/src/format.ts`, `export.ts`, `validation.ts`): the source's sign-in providers and second-factor counts (plus native credential presence) are captured under the export snapshot and bound into a reviewed plan's `snapshot.sourceIdentities`. The plan's existing `snapshot.identities` remain destination facts used for matching and drift.
- `tools/migration/src/identities.ts` reads only the source inventory, fails closed (`E_IDENTITY_INVENTORY_MISSING`) when a provisioned account has no captured facts, and blocks a referenced profile that the merged result does not contain (`E_HISTORICAL_UNRESOLVED`) instead of failing later as an FK orphan.
- `tools/migration/src/import.ts` reports the journaled provisioning outcomes and removes only run-created accounts when a provisioning pass fails; `deploymentSnapshotDigest` now binds destination provider identities and MFA factors; `providers/read.ts` probes `auth.mfa_factors` with `to_regclass` so the compatibility fallback cannot abort the planning transaction.
- At that review point C04's PASS was suspended pending a live rerun. That historical suspension was resolved by the seven-case loopback Supabase recovery run on 2026-09-21; current evidence and remaining gates are recorded in `docs/plans/SUPABASE_NATIVE_MIGRATION_NOTES.md`.

## 2026-09-19 — C03 exporter review

- `tools/migration/src/export.ts` now reads schema metadata, entity rows, and committed-receipt-backed provenance in one repeatable-read source transaction. Provenance uses keyset batches and incremental file hashing/size checks rather than loading the full mapping table into memory; the manifest remains the final artifact.
- `tools/migration/src/providers/session.ts` preserves the transaction callback failure when a dropped connection also prevents rollback, keeping interrupted exports classifiable. The exporter keeps a file-stream error listener while awaiting database batches and reports source values violating known shared destination checks without changing them.
- The C03 PASS claim is suspended pending a disposable live rerun after these fixes and the C06A contract required by the implementation plan. C00 still needs deployment and operator inputs.

## 2026-09-19 — Migration provenance and recovery review

- `tools/migration/src/matching.ts`, `providers/read.ts`, and `resolutions.ts` treat bundle aliases as review evidence and trust only destination-local mappings joined to committed run receipts, including `publication-intent`.
- `tools/migration/src/cli.ts` reads the complete planning destination snapshot in a repeatable-read transaction. `tools/migration/src/schema.ts` binds compatibility to provider-specific schema fingerprints and the paired receipt migrations.
- `tools/migration/src/merge-plan.ts` rejects duplicate user/date timesheets before apply, matching the database unique index.
- `tools/migration/src/identity.ts` and `providers/supabase.ts` mark newly created Auth users with the run id, require that marker to reconcile a lost creation response, and recheck it before cleanup. `tools/migration/src/import.ts` checks a durable receipt after an uncertain SQL commit before any Auth deletion, reads provenance for the planned source namespace during drift checks, and never treats a failed receipt as a completed no-op.
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

- `tools/migration/src/publish.ts` now requires the locked destination gate to be fenced for the receipt's run and namespace before verification, intent, or admission; a stale receipt cannot admit a later run.
- `tools/migration/src/gate.ts` retains a UUID per fenced window, refuses a new generation for a run with a durable receipt, and permits explicit recovery opening only for the matching locked run before publication intent. Normal admission stays atomic in `publish --phase admit` (`tools/migration/src/cli.ts`).
- Provider grant inventory and revocation now share the gate-row lock in one transaction (`tools/migration/src/cli.ts`, `tools/migration/src/providers/fence.ts`). Both migration ledgers require the gate-generation migrations (`tools/migration/src/schema.ts`). This hardens the migration control plane but does not replace deployment-wide writer shutdown or live C06B/C08 proof.

## Current evidence status

The context pack in the working tree is current through `c319473ba02070cc213e6e1a67550ce5811bcf69`. Understand Anything's existing graph remains preserved and structurally valid, but its metadata baseline is `55545e77b7b655b0f72e0b5d889ee61ada6d87e7`; refresh it incrementally before using graph relationships for files changed after that baseline.

## Current architecture baseline

The baseline remains the dual-backend architecture described in `docs/architecture/AI_ARCHITECTURE_CONTEXT.md` and enforced by `AGENTS.md`: a backend-neutral auth facade, narrow provider-selected persistence ports and composition modules, web + versioned mobile HTTP surfaces, two role axes, paired migration tracks, and native/Supabase authorization parity.

## Update rule

Add an entry when a change alters a major boundary, public contract, persistence/auth model, deployment topology, cross-package compatibility surface, or invariant in `CONSTRAINTS.md`. Include the source paths and any ADR/reference that explains the decision.
