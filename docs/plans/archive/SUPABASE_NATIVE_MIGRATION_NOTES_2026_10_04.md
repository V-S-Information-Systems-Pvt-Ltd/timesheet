> Historical reference archived 2026-10-04. The complete previous document body follows;
> dated headings, checkpoint statuses and operational requirements below describe the old process.
> Current execution follows the [four-stage plan](../SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md).
> This snapshot is evidence, not production authorization or a current checklist.

# Supabase/native migration — execution notes and checkpoint ledger

## Status reconciliation — 2026-10-03

The checkpoint table and implementation plan now agree with the later release
corrections: C06A's adopted policy and repository implementation pass; C00 and
C06B's deployment prerequisites remain blocked, C07 remains in progress/blocked,
and C08 has not started and is not ready. C01–C05 PASS entries retain their
recorded implementation/disposable-database scope, rather than certifying a live
deployment. Older dated outcomes below are historical evidence.

Current source confirms mapping-based classification/translation in
`lib/idempotency/portable-retry.ts`, fresh-ticket admission in
`lib/idempotency-fresh-key.ts`, and enqueue-time ticket consumption in the mobile
provider. The October 3 focused rerun passed 35 server tests and 18 mobile queue
tests. No live database or device check ran in this reconciliation. A mobile
client update is required for new reference-free creates after actor remapping;
legacy entries are never assigned fresh tickets on retry.

The first production direction remains Supabase → native. Existing Supabase
project `timesheet-test` is now the selected original-provider recovery target,
while Docker native remains the primary destination. Its scoped logical restore
and reconciliation pass; platform/account recovery and the remaining writer and
session gates stay open. C09/C10 require named production authorization after
their prerequisites.

### 2026-10-03 — scheduled cleanup fence hardening on architecture branch

The current architecture branch closes the repository-level cron writer gap.
`/api/v1/cron/cleanup` still authenticates `CRON_SECRET` first, then performs a
fresh migration-gate read before any maintenance writer runs. Native reads use
the native pool; Supabase reads use the server-only service-role client instead
of request-scoped cookie/bearer state. Fenced, missing, or unreadable gate state
returns 503 and skips session, rate-limit and idempotency cleanup. GET and POST
share the same path.

Focused route and cross-backend gate tests were added. The first dependency
install attempts were blocked by local cache/network permissions, but a later
clean locked install with a workspace-local cache succeeded. The settled focused
verification is 14/14 passing tests across two files; root typecheck and targeted
ESLint pass, and the native production build passes. The Supabase production
build remains environment-blocked at its existing prebuild gate because this
shell does not define `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`; compilation was not reached. `git diff --check`
passes. This does not change the deployed production 1.0.3 release and therefore
does not close provider-level cron stop/deny, manual invocation, or in-flight
drain evidence. The rehearsal-only lifecycle is now explicit in
[`C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md`](C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK_2026_10_04.md).
C06B/C07 remain blocked on those live controls.

## Current review correction — 2026-09-22

**2026-10-03 Vercel deployment continuation:** operator-provided aliases resolve
to the declared main and architecture branches. Public API metadata and exact
commit source agree on production 1.0.3 and development 1.1.2, both Supabase.
The operator's accepted 1.0.3 therefore matches production; local dirty 1.1.6
does not establish a deployed release or justify admission changes. Both aliases
share a Vercel project. CLI cron listing confirms the production cleanup job is
enabled; stop/drain proof remains open. Shared sensitive Supabase URL scope has
no branch override, but its value and running database identity remain unverified.
Authenticated API, env-pull and clean-room env-run probes confirm the sensitive
production value is not retrievable through these Vercel CLI/config surfaces;
a repo-root env-run match came from local `.env.local` and is not deployment
evidence. Close binding with deployment-bound runtime proof or operator
confirmation.
On 2026-10-04 the operator explicitly confirmed that production `ts.kst.st` is
intended to use Supabase source project `bcsdqkjzobllocejfcdz`. This closes the
current production app-to-source identity blocker without claiming that Vercel
exposed the sensitive URL value.
The native application/release is not established by either URL. No deployment,
environment, scheduler, data or fence change ran, and .env.local was not edited.
See [inventory and safe evidence](C00_VERCEL_DEPLOYMENT_INVENTORY.md).
This supersedes older actual-source-release/scheduler UNKNOWN wording without
closing native same-release, C06B/C07 or C08 prerequisites.

**2026-10-03 source recovery verification:** the approved encrypted archive was
restored into verified timesheet-test, retaining Docker native as primary. A
successful rollback rehearsal and fresh reconciliation preceded an acknowledged
commit. Every selected table matched inside the transaction and through a fresh
consistent snapshot: 57 tables / 2,238 rows. All 25 public/private function
definitions/owners/execute grants, sequence counters and Auth API identity
membership match. Managed schema definitions and provider histories remain;
application history now has 71 rows. Four private bodies were recovered from
captured application history with exact source body/privilege checks. The Auth
trigger was preserved and its application hook restored before commit.
Preliminary setval rollback limits and the settled counter protocol are recorded
in [restore result and finding ledger](C00_SUPABASE_SOURCE_RESTORE.md).
This supersedes restore-pending/empty-target wording in earlier observations.
Password login, full platform recovery, durable/off-host retention, actual
deployed release policy, enrollment and writer/client/session gates remain open.
C00/C06B/C07 are partial; C08 has not started. No live source write, portable
transfer, provider freeze, billing change, cutover or retirement ran.

**2026-10-03 existing recovery target:** the operator selected MIGRATION_DESTINATION
settings for timesheet-test as Supabase recovery, retaining Docker native as
primary, and authorized data removal after exact project-name verification.
CLI identity/source distinction, database TLS/read-only probe and destination
Auth access pass. One acknowledged transaction cleared 58 rows across 22 public
tables with TRUNCATE RESTRICT. Independent post-commit checks confirm zero public
rows, unchanged table/function/policy counts, empty Auth/storage and unchanged
69-row application history. No source/native write, managed schema drop, email,
new project, payment or plan change ran. [Evidence and remaining scope](C00_TIMESHEET_TEST_RECOVERY.md).
The proposed new recovery-project billing/provisioning gate is superseded;
original-provider restore/schema reconciliation and other C00/C06B/C07 gates
remain open. C08 has not started. Older billing notes below are historical.

**2026-10-03 protected source continuation:** explicit operator approval covered
source public/Auth/storage/history capture and encrypted local retention after
automatic approval review requested that scope. One custom archive with owners
and ACLs and separate password-hash-free role metadata were protected with
Windows DPAPI CurrentUser. Persisted files decrypted with matching digests;
archive inventory checks pass. Client/source major version 17 and verified
client TLS with the official Supabase CA pass. No source writes or restore ran.
See [source backup readiness](C00_PROTECTED_SOURCE_BACKUP.md).
At this point in the continuation, CLI metadata showed the proposed new hosted
recovery project as absent and the operator limited any provisioning attempt to
Free only, with no payment or upgrade authorized. That creation path is now
superseded by the existing `timesheet-test` selection and its successful scoped
logical restore/reconciliation. No payment or plan upgrade ran. Automatic
approval review rejected direct Credential Manager token extraction for an API
plan check; no such read or API request executed. Local native enrollment
settings remain absent. Deployment inventory now establishes production 1.0.3
and development 1.1.2, both Supabase; the exact running Vercel app-to-source
project binding remains unverified. No portable bundle was exported under an
inferred release. C00/C06B/C07 remain partial/blocked and C08 has not started.

**2026-10-03 legacy-field continuation:** the operator authorized skipping
profiles.full_name and planning its retirement. Existing canonical projection
and snapshot-bound legacy equality checks are unchanged. Exact legacy and
retired Supabase source shapes are admitted for source use only; destination
schemas and required row values remain strict. Live read-only inspection,
Auth/database binding, fingerprint support, ledger and equality pass. No live
DDL, transfer, fence or retirement ran. See [compatibility evidence](../evidence/c00-source-compatibility-2026-10-03.json)
and the [retirement plan](../PROFILE_FULL_NAME_RETIREMENT_PLAN.md).
The migration package passed 343 unit tests, lint, type checking and coverage.
C00-11 is resolved; overall C00/C06B/C07 operational gates, full account/platform
recovery and durable retention evidence remain open, and C08 has not started. The unsupported-fingerprint
observation below records the pre-fix state.

**2026-10-03 source connection continuation:** the explicit migration settings
in Git-ignored `.env.local` were read in memory without printing their values.
The operator's Session pooler update resolved the initial IPv6 reachability
failure. Read-only CLI inspection, endpoint project binding, API-to-database
account binding, canonical column compatibility and required migration ledger
entries pass. Full fingerprint support remains blocked: `profiles.full_name` is
an extra column with one populated row, and four canonical columns allow nulls
despite currently containing none. No source schema/data change or fingerprint
bypass occurred. The later count is 854 timesheets (1,011 canonical rows), with
maximum observed SQL JSON row size 1,267 bytes and app_settings size 462 bytes.
[Safe evidence](../evidence/c00-source-inspect-2026-10-03.json) records structural
metadata, hashes, codes, counts and booleans, never settings or account values.
The populated legacy name exactly matches profiles.name; zero divergent rows
were observed, and current app code uses name. The existing export legacy-data
guard rejects divergence. The earlier preservation question is superseded by
this evidence; narrow schema admission is resolved while full recovery/retention
evidence and the remaining operational gates stay open.
C00/C06B/C07 operational gates remain blocked and C08 has not started.

**2026-10-03 backup/upgrade continuation:** a DPAPI-protected custom archive of
the fresh native baseline decrypted and restored into a unique disposable
database; all 24 public tables and inspected schema metadata matched. The
supported baseline-to-current native upgrade integration test passed 1/1;
fixtures were removed and the C00 destination stayed unchanged. Hosted backup
metadata lists no physical backups and PITR disabled. Host resource observations
are recorded, without claiming representative-volume capacity or RPO/RTO proof.
See [backup and upgrade readiness](C00_BACKUP_AND_UPGRADE_READINESS.md).
C00/C06B/C07 remain blocked on their operational gates; C08 has not started.

**2026-10-03 live inventory update:** the operator selected hosted source
`bcsdqkjzobllocejfcdz` and authorized a fresh Docker native destination,
`vsis_migration_destination_20261003`. Source aggregate scans collected 1,356
public rows (1,010 canonical entity rows), three title/hierarchy differences,
54 unexpired mobile sessions and 220 unexpired fresh keys. The fresh destination
passed 37 canonical migrations, checksum verification and read-only CLI inspect;
baseline reference overlaps still require reviewed matching. The operator also
requested a new hosted Supabase recovery project and confirmed the source
organization. Connector tools were unavailable; changing CLI login restored the
organization and source-project visibility. That proposed Tokyo-project creation
path is historical and superseded by the existing `timesheet-test` recovery
target, which later passed scoped logical restore/reconciliation.
Details and evidence are in
[C00 live inventory](C00_LIVE_INVENTORY_2026_10_03.md). C00 remains PARTIAL/BLOCKED
on the remaining operational gates. This supplies initial live volume evidence;
older statements that every live input or numeric budget is unanswered are
historical, not the current blocker. No source correction, transfer, fence,
rehearsal or cutover ran in that initial inventory.

**2026-10-03 local fence continuation:** existing native provider-fence and V6
integration suites passed 11 tests with one hosted Supabase live test skipped.
The unique disposable database/role were removed after the test process exited;
the C00 destination's ledger, gate and public-table counts were unchanged.
Authentication is mocked in V6. The
[writer-control inventory](C00_WRITER_CONTROL_INVENTORY.md) records exact source
boundaries and the configured daily cron cleanup writer, whose deployed owner and
shutdown/drain controls remain unknown. This is mechanism evidence, not a C06B
or C07 release PASS, and no hosted source was fenced.

**2026-09-23 merge-safety correction:** reference-free mobile creates by a remapped actor were unconditionally parked for manual review. The branch adds server-minted, actor/operation/fence-generation-bound fresh keys and a mobile queue path that assigns them only when an operation is newly enqueued; old queue entries retain their original keys and fail closed. This closes the permanent-new-reminder regression in code, but an updated mobile release and the C07 real client/session matrix remain required. It does **not** change the C06B provider-fence, C08 rehearsal, or C09 authorization blockers below.

C06B is not a provider-fence PASS. Application write-gate/publication/retry work and a partial SQL privilege-fence primitive are delivered, but plan §11 is **BLOCKED** until C00 inventories and selects real provider controls and live tests cover both deployments, Auth/admin, jobs/integrations, ingress, and existing connections. The SQL privilege fence does not itself stop those surfaces.

C07 remains **IN PROGRESS/BLOCKED** for those deployment-specific legs. C08 is **not ready** until the provider lifecycle and operator inputs are complete. This correction supersedes any earlier PASS language in this historical ledger.

Created at C00 per `docs/plans/SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md` §9.
This file is updated after every checkpoint. It contains no record bodies, credentials, or sample personal data.

## Outcome (current)

**C00 direction decision (operator-confirmed 2026-09-23):** the first production direction is Supabase → native; native is the long-term backend. The later existing timesheet-test selection and scoped logical source restore satisfy recovery-target access and selected data/schema verification. C00 remains BLOCKED on full account/platform recovery, retention, deployed inventory, writer controls, capacity and other operational inputs. The local native recovery database alone cannot satisfy the Supabase recovery requirement. The operator reports mobile is not in production; test/development clients, pending writes and issued retry tickets still require inventory.

The C00 repository inventory is complete, but C00 is **BLOCKED** against its PASS criteria until live-deployment inventory and operator decisions are recorded. No production migration has been attempted; production transfer additionally requires explicit C09 authorization. C01, C01M, C02, C03, C04, C05 and C06A are **PASS**; C06B is **BLOCKED/PARTIAL** pending the provider-level §11 controls and live proof. C07 is **IN PROGRESS/BLOCKED** on those deployment-specific legs as well as its remaining fresh-install/upgrade and live client/session matrix, and C08 is **NOT READY / NOT STARTED**.

## Pending work

This checklist separates code review from permission to run a migration. The mobile app is not in production; its real-device matrix remains a migration release gate, not a current production-usage incident.

### PR #8 code merge

- [ ] Confirm the PR head is mergeable with `main` and the complete GitHub CI matrix runs on that exact head commit. Resolve any reported failures before merging; local builds and tests do not replace the PR checks.
- [ ] Review the final PR diff and required approvals after CI. The code merge does not authorize a data transfer.

### Migration release (deferred from this code merge)

- [ ] **C00:** finish deployment/writer inventory and shutdown/drain proof, full account/platform recovery, capacity, retention, access-window and SMTP/enrollment inputs. Live catalog inspection and the existing Supabase target's scoped logical restore pass; the target now contains the restored source snapshot. The operator supplied fewer than 50,000 rows, 10% monthly growth, a 60-minute freeze, 120-minute RPO, 720-minute RTO and no external files.
- [ ] **C06B:** prove both deployments reject writes through application, PostgREST, Auth/admin, jobs, integrations and established connections while fenced; record the exact release and recovery procedure. The current SQL privilege fence is only one part of this control.
- [ ] **C07:** complete the real client/session and remapped-actor replay matrix, including stale queued keys and the supported mobile client version, and retain CI evidence for both backend schema paths.
- [ ] **C08:** run and measure the full disposable rehearsal and both recovery paths when the operator resumes it; this was explicitly deferred.
- [ ] **C09/C10:** obtain separate authorization for a named production cutover, then complete the observation and handoff gates.

## Baseline

| Field | Value |
|---|---|
| Recorded at | 2026-09-19 (C00 execution) |
| Plan baseline revision | `a2cead0d3ed6e6d8fe9a67b2e70e119ffec3e5fc` |
| Working tree HEAD at C00 | `89d20effa8e2b8e5e0ebeca3e4ff7e1df3ae29a2` |
| Working tree status | clean at C00 start; after C00 only this notes file is added (`git status --short`: `?? docs/plans/SUPABASE_NATIVE_MIGRATION_NOTES.md`) |
| Application version | 1.0.3 (`package.json`) |
| Backends | `native` (self-hosted PostgreSQL, scrypt auth) and `supabase` (PostgREST + Supabase Auth), selected by `NEXT_PUBLIC_BACKEND` |

## Checkpoint ledger

| Checkpoint | Status | Evidence / notes |
|---|---|---|
| C00 | PARTIAL / BLOCKED (repository inventory and initial live scans complete) | Supabase → native is the first production direction. [October 3 live inventory](C00_LIVE_INVENTORY_2026_10_03.md) records source counts/integrity scans, a fresh migrated native destination, reference comparisons and known budgets. Canonical source database/Auth binding passes; production `ts.kst.st` → source project `bcsdqkjzobllocejfcdz` is operator-confirmed; and existing Supabase project `timesheet-test` is the selected original-provider recovery target with scoped logical restore/reconciliation passed. Three hierarchy differences and reference attribute/UUID differences still need reviewed decisions. Remaining gates are provider-wide writer stop/drain controls (including cron/manual invocation, Auth/admin, privileged SQL/service-role clients, external integrations and old deployment URLs), full account/platform recovery plus durable retention, pending-client/device inventory, SMTP/enrollment readiness, and the remaining declared C08 resource ceilings. |
| C01 | PASS (repository + disposable-database legs) | Bundle format/validator, explicit connectors, read-only sessions, run journal and the `validate`/`inspect`/`preflight` CLI. V2: 53 tests pass (`tools/migration/tests/migration-format.test.ts`, `tools/migration/tests/migration-cli.test.ts`). V3: typecheck, lint, boundary tests (12) and coverage gate pass. Live: read-only `inspect` against the local Supabase stack and a disposable native database (write probes rejected); live `preflight` validated a fixture bundle, rejected same-instance aliasing and blocked (exit 5) on unverifiable Auth binding. See the C01 section below. |
| C01M | PASS (repository level; live slice still C02) | Matching, ID/provenance mapping, read-only preview, versioned resolution files and the expected merged state with invariant validation. `plan`/`resolve` CLI commands. V2: 43 merge-plan tests + 40 CLI tests (114 across the four migration/boundary suites). V3: typecheck, lint, boundary tests and coverage gate pass. An independent read-only review round produced four must-fix findings; all were fixed and covered by new tests (see "C01M review round"). Destructive database behavior (constraint triggers, RLS) is **not** claimed here; that is the C02 live-slice gate. |
| C02 | PASS (current-revision live recovery evidence) | Export → plan → resolve → apply → verify passed 6/6 in both directions against disposable native databases plus the local Supabase stack, including destination enrollment. `tools/migration/tests/migration-recovery.int.test.ts` passed 7/7 with `MIGRATION_TEST_REQUIRE=1`: lost Auth response, recoverable lost commit response, unreadable post-commit receipt (`E_COMMIT_UNCERTAIN` without cleanup), source identity blockers and the failure cases shared with C04/C05. Teardown verified the prior gate state, whitelist, receipts, journals and accounts were restored/removed as owned. |
| C03 | PASS (reassessed against the adopted C06A contract; live export 7/7) | The exporter emits digest-bound `retry-history.json` for the eight queued operations and the validator enforces namespace, count, size, digest and outcome coherence. **Reassessment (no code change):** the adopted C06A rule operates on *incoming* retry payloads at the destination (`lib/idempotency.ts`); the exporter's job is to carry the source's committed/uncertain outcomes with their namespace, which is exactly what the artifact does, so nothing in the rule invalidates the export contract. C03 has no remaining implementation item. **Live evidence:** `tools/migration/tests/migration-export.int.test.ts` 7/7 with `MIGRATION_TEST_REQUIRE=1` against a disposable native database (including the 1,001-project / 5,224-timesheet volume matrix, the interruption case and the gate-durability transition). |
| C04 | PASS (identity failure matrix live) | Every source account is mapped, newly provisioned, historical/non-login or explicitly excluded; unresolved assurance/ownership blocks apply. The digest-bound source identity inventory stays separate from destination facts, enrollment is recorded separately, and only marker/journal-owned accounts are eligible for cleanup. The current recovery suite passed all four targeted round-2 cases live: Auth identity without profile (`E_IDENTITY_WITHOUT_PROFILE`), Auth/profile email mismatch (`E_IDENTITY_EMAIL_MISMATCH`), unrelated drift after provisioning (`E_DESTINATION_DRIFT`, run account removed and unrelated account preserved), and failed identity-journal write (marker-owned account removed). The same local stack passed the existing Supabase RLS/registration regressions 17/17. |
| C05 | PASS (commit-boundary recovery live) | The importer persists and reconciles rows, mappings, dispositions, exclusions and retry history under the destination gate. `verifyMappings` uses `(source_namespace, entity, source_id)` rather than `run_id`; the unit fake pins that SQL/parameter contract, so a later owner with the same destination remains valid while a changed destination fails with `E_MAPPING_MISMATCH`. The live round trip passed 6/6 with reconciliation, repeat no-op, later-bundle reverse and rollback proof. The current recovery suite passed both lost-commit outcomes: durable-receipt recovery to `verified`, and an unavailable first receipt read returning only `E_COMMIT_UNCERTAIN` without cleanup followed by a fresh-session verified no-op. |
| C06A | PASS (adopted contract/repository implementation; live device release proof remains C07) | Portable committed and uncertain outcomes are implemented: artifact, protected dual-backend table, mapped actor/resource facts, reverse-ID fingerprint comparison, unique-match replay, ambiguity rejection and fail-closed handling. The withdrawn PASS rested on one case — a queue item that never reached the source — which is now decided and implemented: `lib/idempotency.ts` classifies such a payload by what resolves (`decidePortablePayload`, ids keyed by entity and id), translates a fully source-era payload in place so the executed write carries destination ids, runs a destination-era payload unchanged, and refuses a mixed payload, an id present on both sides of the mapping, or an actor with more than one mapped namespace for manual review with the payload preserved. Identifier-bearing classification uses server-owned provenance. New reference-free creates require an updated client and actor/operation/expiry/generation-bound server-issued tickets; legacy items are preserved for manual review. Evidence: `tests/migration-portable-classification.test.ts` 9/9, `tests/migration-retry-history.test.ts` 12/12 (the three operations now translate and execute; two new review cases), unit suite 1628 passed / 72 skipped, and the live legs re-run on this revision (round trip 6/6, export 7/7, fence V6 3/3, Supabase auth 17/17). **Not claimed:** the portable-retry path is exercised by integration tests and the live round trip, not by a live mobile device against disposable services. |
| C06B | BLOCKED/PARTIAL (application mechanisms delivered; full provider lifecycle proof remains) | **Fences (task 1):** the durable gate in both tracks; enforcement on every write path (`requireActive`, `requireMobileActor`, `requireActiveActor` refuse state-mutating requests with 503 `WRITERS_FENCED` + retry-after after origin and credential checks, reads pass, an unreadable gate refuses); `apply` takes the gate row lock first and refuses an open gate with `E_WRITERS_NOT_FENCED`. **Session/retry strategy (task 2):** the C06A contract's strategy is implemented, including the adopted classification rule for never-committed payloads. **Publication intent (task 3):** `verify --record` persists `verified`; `publish --phase intent` requires it; `--phase admit` sets the receipt to `writable` and opens the gate in one transaction; `gate --state open` refuses without a recorded intent; the gate is readable by signed-in callers and writable only by the service role, so ordinary users cannot set it. **Uncertain enablement (task 4):** a lost admission response resolves to the durable outcome, and a crash between the receipt update and the gate update leaves neither in effect. **Rate-limit/maintenance state (task 5):** contract §5 — not migrated, offline work preserved rather than deleted. **Operator procedures (task 6):** contract §6/§8 plus the CLI (`gate`, `publish`, `verify --record`) name the exact commands. **V6 matrix:** live `tools/migration/tests/migration-fence-v6.int.test.ts` 3/3 (writes refused while fenced and admitted after the recorded sequence, crash at intent, lost admission response, crash mid-admission), hermetic `tools/migration/tests/migration-gate.test.ts` 16/16 (REST, Server Action and mobile-API refusals, unreadable-gate refusal, publication sequence), live round trip 6/6 covering the reopened gate in teardown. **Not claimed:** the mobile-API leg runs hermetically rather than against a live device, and C06A's never-committed queue path is exercised by integration tests, not by a real device queue. |
| C07 | IN PROGRESS/BLOCKED (CI and upgrade mechanisms delivered; provider-wide and real client/session proof remains) | **Task 4 delivered:** the migration suites run in CI with `MIGRATION_TEST_REQUIRE=1` and an explicit prerequisite check that fails setup naming the missing variable, so the job cannot go green by skipping its real database suite. The export, fence and upgrade-path suites run in the native job against their own disposable databases; the round trip and the recovery suite run in the job that has the Supabase stack. No production credentials; existing checks and thresholds untouched (task 5). **Fresh installation** is covered by the Supabase job's `supabase db reset` with migration-history verification and by the native job's migration run. **Supported upgrade path (new):** `tools/migration/tests/migration-upgrade-path.int.test.ts` materializes the migration set from an earlier release (`3964600` by default, `MIGRATION_TEST_UPGRADE_BASE_REF` overridable), applies it to a disposable database, seeds rows and a durable receipt, upgrades with the current set, and asserts that only the three newest migrations run, that the seeded rows and the receipt survive untouched, that `migration_write_gate` is bootstrapped and the disposition/retry surfaces exist and are empty, and that a re-run applies nothing. **Tasks 1-3 coverage:** deterministic fixtures and the overlap/collision/equal-looking cases live in the round trip; every supported resolution choice is pinned by `tools/migration/tests/migration-v4-resolution-matrix.test.ts`; corruption, capacity, stale-plan and crash cases are covered by the format, validator, merge-plan, session and fence suites; secrets-in-artifacts by the format/CLI redaction checks. **Remaining C07 work:** the real client/session matrix (live devices, remapped-actor replay, keys older than the horizon) — the release-gate PASS depends on it. The performance/rehearsal work is C08. |
| C08 | NOT READY / NOT STARTED — prerequisite gates remain open | Rehearsal runbook in [`C08_REHEARSAL_RUNBOOK.md`](C08_REHEARSAL_RUNBOOK_2026_10_04.md): phase measurements, both recovery rehearsals, and budget misses remaining BLOCKED. The operator has supplied volume/growth/downtime/recovery budgets; October 3 source scans now provide initial counts. Complete C00/C06B/C07 controls, recovery readiness and operational proof before a measured run. |
| C09 | NOT STARTED | Explicit production authorization required; not requested. |
| C10 | NOT STARTED | |

**Current release-gate correction (reconciled 2026-10-03):** The historical C06B `PASS` covers the application-level gate and earlier V6 checks only; it is **PARTIAL**, not a release PASS. The SQL privilege fence still lacks deployment-wide proof for Auth/admin, jobs, integrations, ingress and established sessions on both sides. The architecture branch now also fences scheduled cleanup at the route after cron-secret authentication, but production 1.0.3 does not contain that hardening, so provider-level cron denial/drain remains mandatory. C07 remains **IN PROGRESS/BLOCKED**: live recovery/retry/build/upgrade suites are green, while the real-device/session/remapped-actor/horizon proof and provider-wide writer lifecycle are still open. C08 is **NOT STARTED** for measured rehearsal. The operator has declared a local disposable source (`.env.2.local`), local Docker destination, fewer than 50,000 rows, 10% monthly growth, a 60-minute freeze, 120-minute RPO, 720-minute RTO and no external files; existing `timesheet-test` is now the selected Supabase recovery target and its scoped restore/reconciliation passed. C00 remains **BLOCKED** on the remaining deployment writer controls, full account/platform recovery and retention evidence, client/integration inventory, enrollment readiness and resource ceilings. C09/C10 cannot run before their plan gates and explicit production authorization. The publication path refuses raw normal `gate --state open`; only atomic `publish --phase admit` can admit normally, while `--recovery --run-id` must match the locked current fence after baseline restoration.

**Full-access local retry (2026-09-23):** Docker's per-user CLI and both loopback databases were reachable. The local Supabase stack was missing `20261004000000_migration_write_gate_generation.sql`; it was applied with `supabase migration up --local` (no hosted project). After correcting stale test fixtures and running shared-database suites serially, the native export (7/7), native gate V6 (3/3), native upgrade (1/1), native privilege fence (8/8 with the Supabase leg skipped), Supabase recovery (7/7), native↔Supabase round trip (6/6), and Supabase privilege fence (8/8 with the native leg skipped) passed. The full unit suite passed 1,689 tests with 85 skipped; typecheck and lint passed. The local Supabase gate was verified open after round-trip teardown, with no C02 run receipts; the provider-fence suite verified its original direct grants were restored. The upgrade fixture now includes additive working-tree migrations (0036) while preserving HEAD bytes for already-applied checksum comparisons, and the round-trip suite binds the initial fence to its run ID and asserts a verified receipt's read-only no-op/drift result. These are **mechanism proofs**, not a C06B/C07/C08 release PASS: the real `.env.2.local` source has no migration DB URL, the deployment writer inventory and full lifecycle fence are unproven, a Supabase original-provider recovery target is not reserved, and no representative-volume timing or live-device matrix has run.

## Confirmed requirements (restated from the plan; not re-asked)

- Planned switching with both writers fenced during final planning/apply; measured downtime budget still to be recorded (BLOCKED C00 item).
- Populated destinations supported and protected; empty destinations also supported.
- Incoming passwords are not transferred; existing destination credentials keep working; new accounts enroll on the destination.
- Both deployments run the same application release; each provider's schema fingerprint is verified independently.
- Unified identity behavior through the existing auth facade/identity contracts; no new identity service.
- Keep existing destination IDs where safe; otherwise allocate and persist complete mappings.

## Durable-data classification (C00 deliverable 3)

Derived from the migration SQL of both providers. **Live catalog confirmation is a BLOCKED C00 item** — source files alone do not establish deployed state.

### Business data (in the future migration bundle)

| Table | Columns (canonical order) | Constraints a merge must re-validate | Provider differences |
|---|---|---|---|
| `profiles` | id (uuid pk), email (uniq), name, department, title, permission_role (admin/pm/co/user), hierarchy_role (manager/team_lead/engineer/user), is_active, manager_id (self-fk, set null), dashboard_layout (jsonb), admin_layout (jsonb), mobile_layout (jsonb), created_at | role CHECKs (`N 0009:21-27`, `S 20260826000000`); legacy `role` re-derived by trigger `sync_legacy_role` (`N 0009:30-46`, `S 20260826000000:26-42`) — legacy column must never be imported, it is recomputed on the destination | **N-only (exclude from bundle):** `password_hash` (`N 0001:27`), `session_version` (`N 0023:4-11`). **S-only (exclude):** `mobile_password_change_started_at` (`S 20260924000000:5`). S `profiles.id` references `auth.users(id) on delete cascade` (`S 20260810160000:29`) — destination identity must exist before profile state; the `on_auth_user_created` trigger enforces the domain whitelist and auto-activate (`S 20260825000000:30-64`) |
| `projects` | id, name (uniq), so_number, telegram_no (unique partial where not null), created_at | unique name; unique telegram_no (`N 0003:13-19`, `S 20260816000000:13-19`) | none |
| `activity_types` | id, name (uniq), is_active, telegram_no (unique partial), created_at | as above (`N 0002`, `S 20260815000000`) | none |
| `timesheets` | id, user_id fk, project_id fk (restrict), activity_type_id fk nullable (set null), log_date (date), hours_worked numeric(4,2), work_done, created_at | CHECK `hours_worked > 0 AND <= 24` (`N 0015:7-9`, `S 20260831000000:7-9`); daily-cap trigger `check_daily_hours_limit` with advisory lock (`N 0011/0015`, `S 20260823000000/20260831000000`); `(user_id, log_date)` uniqueness was dropped — multiple entries/day (`N 0005:8`, `S 20260818000000:8`) | `work_done` unbounded at DB level; the S restore RPC truncates it to 2000 chars (`S 20260914000000:86-88`) — migration export must not imitate that |
| `leaves` | id, user_id fk, leave_date, reason, created_at | UNIQUE `(user_id, leave_date)`; CHECK `char_length(reason) <= 500` NOT VALID (`N 0017:13-16`, `S 20260905010000:18-21`) — pre-existing violations possible on either side | none |
| `reminders` | id, user_id fk, message, remind_at, done, created_at | CHECK `char_length(message) <= 500` NOT VALID (`N 0017:18-21`, `S 20260905010000:23-26`) | none |
| `global_reminders` | id, message, remind_at, created_at | none | none |
| `global_reminder_dismissals` | user_id fk, reminder_id fk (composite pk), dismissed_at | none | none |
| `app_settings` | id=1 singleton, backfill_window_days, backfill_mode (days/month_start), backfill_extra_days, default_dashboard_layout, default_admin_layout, default_mobile_layout, app_name, primary_color, logo_url, updated_at | singleton CHECK id=1; mode CHECK (`N 0001/0002/0010/0019/0020`, `S 20260813000000/20260815000000/20260827000000/20260907000000/20260908000000`) | none |
| `titles` | id (**N: text** `gen_random_uuid()::text` / **S: uuid**), name (uniq), hierarchy_role, created_at | unique name; hierarchy_role CHECK (`N 0014/0021/0022`, `S 20260830000000/20260909000000`) | **PK type differs** — a cross-provider copy is a declared transformation, not a value copy. N-only functional unique index on `lower(name)` (`N 0022:4`) has no S equivalent |
| `whitelisted_domains` | id (**N: text / S: uuid**), domain (uniq), auto_activate, created_at | unique domain | same PK-type difference |
| `audit_logs` | id, actor_id fk nullable (set null), actor_email, action, target_id, detail (jsonb), created_at | none | S insert policy binds `actor_id = auth.uid()` (`S 20260824000000:20-42`) — historical import goes through service role; append-only semantics preserved |

### Internal / operational (excluded from bundle; disposition per category)

| Table | Providers | Disposition |
|---|---|---|
| `mobile_sessions` | both (`N 0017:4-25`, `S 20260904000000`) | Excluded — session safety is C06A/C06B scope; the S table is service-role-only with a password-change insert guard trigger |
| `password_reset_tokens` | N only (`N 0023:13-27`) | Excluded — destination recovery behavior is authoritative |
| `rate_limits` | both (`N 0024:16-33`, `S 20260911000000`) | Excluded (operational state); S access is service-role-only via SECURITY DEFINER RPCs |
| `idempotency_keys` | both (`N 0026:4-15`, `S 20260913010000`) | Operational state — **do not bulk-copy**; semantic mapping is a C06A contract decision |
| `idempotency_effects` | S only (`S 20260920000000:51-85`); N `0031` is an explicit no-op | Provider-specific effect evidence — not interchangeable; C06A decides |
| `migration_runs`, `migration_record_map`, `migration_identity_journal` | Both (`N 0032`, `S 20260930000000`) | Destination-local migration receipts, mappings, and identity-operation evidence; excluded from business-data bundles. C01M may use destination receipts to verify provenance, while C02/C05 must write them with the reviewed merge. Supabase tables have RLS enabled and public/anon/authenticated grants revoked. |
| Migration ledgers | `public.schema_migrations` (created by `db/migrate-runner.mjs:55-62`, not by migration SQL), `supabase_migrations.schema_migrations` | Provider infrastructure — never copied |

### Provider-owned (never copied)

`auth` (Supabase Auth; FK target of `profiles.id`, `auth.uid()` in ~40 policies/functions), `supabase_migrations`, and the app-created `private` schema holding SECURITY DEFINER idempotency trigger helpers (`S 20260920000000:92-95`). `storage`/`realtime`/`extensions`/`vault`/`pgsodium` are unreferenced in both migration trees. External objects (logo files etc.) are deployment-specific; their inventory is a BLOCKED C00 item.

### Provider deltas that shape the later design

1. `profiles.id` = `auth.users.id` on Supabase: native→supabase identity provisioning must create Auth users with preserved or explicitly mapped UUIDs before profile/business rows; supabase→native is a plain copy minus credential columns.
2. `titles.id`/`whitelisted_domains.id` text (N) vs uuid (S): the canonical contract validates UUID-shaped values and accepts both provider storage types; exact provider fingerprints reject unexplained schema drift.
3. No sequences or generated columns exist anywhere; UUID defaults only — no sequence reconciliation is needed.
4. NOT VALID CHECKs (`leaves`, `reminders`) can hide pre-existing violations — the live scan (BLOCKED) must check them before any merge claim.
5. The Supabase SECURITY DEFINER surface (report/restore/idempotency/session RPCs) is recreated by provider migrations, never copied.

## Data inventory (C00 deliverable 4) — BLOCKED

Requires read-only access to both live datasets: row volumes per table, normalized-email collisions, UUID collisions, reference-name conflicts, singleton settings state, orphan references, legacy `role` inconsistencies, NOT-VALID-constraint violations, deleted-actor references, timestamp precision and hierarchy shape. **Not executed in this environment.** No silent cleanup or account linking will be inferred; findings will be recorded here once an operator provides disposable or authorized read-only access.

## Operational inputs (C00 deliverables 5–6) — BLOCKED (operator-supplied)

- Numeric downtime and recovery budgets; bundle retention period; observation window; access windows.
- External-object scope (logo/files), pending mobile writes, SMTP/enrollment readiness; the first production direction is recorded above.
- Recovery destination reservation for the entire merged authority after target writes (including provisioning/reenrollment cost).
- Recoverable backup inventory for source and destination (data + Auth + objects) and the named conflict reviewers.
- Destination-owned rows/identities/configuration that must survive; schema-only bootstrap policy for empty-target tests; same-application-release verification across both deployments.

## Verification evidence (C00)

| Command | Result |
|---|---|
| V0: `rtk proxy git rev-parse HEAD` / `git status --short` / `git diff --stat` / `git diff --check` | HEAD `89d20effa8e2b8e5e0ebeca3e4ff7e1df3ae29a2`; tree clean at start; no whitespace problems; after C00 the only change is this notes file (untracked) |
| V1: `rtk proxy npm test -- tests/backup.test.ts tests/operations-domain.test.ts tests/supabase-restore.test.ts tests/backup-restore-route.test.ts` | **4 files, 38/38 tests passed** — matches the architecture assessment's 38 passes at the recorded revision; no existing failure to attribute |
| Schema inventory | Static read of both `migrations/` trees (matrix above); live catalog inspection BLOCKED |

## Deviations from the plan

None. All C00 deliverables were either completed from repository evidence or recorded as BLOCKED with their required inputs named; no policy was guessed and no deployment was touched.

## Delegation and file ownership

Implementation work is committed per checkpoint; each checkpoint updates this ledger in the same commit. The plan's checkpoint order is respected; C01M (planning semantics) is implemented before any database slice.

## Implementation at checkpoint C01

**Deliverables (all committed on `arch/dual-backend-modular-implementation`):**

| Path | Purpose |
|---|---|
| `tools/migration/src/format.ts` | Bundle format v1, canonical value contract, entity/column allowlist (12 entities), dependency order, provenance/plan/resolution base schemas, digests. |
| `tools/migration/src/validation.ts` | Offline bundle validation: symlinks, unknown files, size/row bounds, digests, canonical bytes, primary-key uniqueness, dependency order, provenance. |
| `tools/migration/src/schema.ts` | Pure catalog model, schema fingerprint, canonical-kind vs live-UDT compatibility. |
| `tools/migration/src/connections.ts` | Explicit `MIGRATION_*` env resolution, provider allowlist, project-ref extraction, Auth/database binding rules. |
| `tools/migration/src/journal.ts` | Exclusive run directory/artifacts, append-only JSONL journal, run lock, secret-shaped redaction. |
| `tools/migration/src/providers/session.ts` | Dedicated read-only PostgreSQL session (`default_transaction_read_only`, statement allowlist, write probe) and stable instance namespace/runtime fingerprint. |
| `tools/migration/src/providers/native.ts`, `providers/supabase.ts` | Provider consistency guards, instance inspection, Supabase Auth admin read port and Auth↔database read-only consistency proof. |
| `tools/migration/src/cli.ts`, `tools/migration/src/cli-entry.ts` | `validate`, `inspect`, `preflight` commands; unambiguous exit codes 0/1/2/3/4/5. |
| `tools/migration/tests/migration-format.test.ts`, `tools/migration/tests/migration-cli.test.ts`, `tests/helpers/migration-fixtures.ts` | 53 unit tests over the contract, validator, CLI safety boundary and dry-run guarantees. |
| `tests/boundary-enforcement.test.ts` | Two new rules: application/package/mobile code cannot import migration tooling; migration tooling cannot import server-only sentinels, request-bound auth modules, `lib/db/pool`, Next.js modules or mail senders. |
| `package.json`, `.gitignore` | `npm run migration` (tsx); `/.migration-runs/` ignored. |

**Verification (executed):**

| Command | Result |
|---|---|
| `npx vitest run tools/migration/tests/migration-format.test.ts tools/migration/tests/migration-cli.test.ts` | 53/53 passed. |
| `npx vitest run tests/boundary-enforcement.test.ts` | 12/12 passed (including the two new migration rules). |
| `npm test` | 1386 passed, 56 pre-existing integration tests skipped (no `TEST_DATABASE_URL`/Supabase test env in this shell). |
| `npm run typecheck`, `npm run lint` | Pass, no new warnings. |
| `npm run test:coverage` | Exit 0; aggregate thresholds intact; `tools/migration/src` at 82.31% lines / 73.44% branches / 85% functions. |
| Live `inspect --source native` against disposable `vsis_migration_native_test` (31 native migrations applied) | Read-only probe rejected a write; namespace `native:7071be336042327a…`; schema fingerprint computed; zero missing tables. |
| Live `inspect --target supabase` against the local Supabase stack | Read-only probe rejected a write; namespace `supabase:3167909b3f99f5e6…`; 65 applied migrations; Auth user list reachable. |
| Live `preflight` (fixture bundle, native source → Supabase target) | bundle/schema/migrations/distinct-instance checks pass; Auth binding reported `blocked` because the local project has no users yet → exit 5 (fail-closed as designed). |

**Decisions / deviations recorded:**

1. CLI command bodies live in `tools/migration/src/cli.ts`; `tools/migration/src/cli-entry.ts` is a thin entry. The plan listed the script as the composition surface; keeping logic in a module makes the commands testable without spawning processes (same interface, no behavior change).
2. Connection env names must match `^MIGRATION_[A-Z0-9_]+$`. This is stricter than "explicitly named env var" and makes "never falls back to `DATABASE_URL`" mechanically enforceable and testable.
3. Added `tools/migration/src/schema.ts` and `tools/migration/src/providers/session.ts` as small shared modules beyond the plan's file list; the plan permits consolidating helpers.
4. Canonical kind for `titles.id` / `whitelisted_domains.id` is `uuid`. The original C01 decision required a declared transformation for native text storage; C02 replaced it with a provider-specific compatibility rule that validates UUID-shaped values and retains exact schema fingerprints.
5. JSONL must be canonical bytes and end with a newline; non-canonical rows and truncation are validation errors (`E_NON_CANONICAL_ROW`, `E_TRUNCATED`).
6. `preflight` exits `BLOCKED` (5) — not pass — when a Supabase target's Auth binding cannot be verified; the plan requires uncertainty to reject before import.
7. A temporary scratch script built the live-preflight fixture bundle; it was deleted after use and is not part of the tree.

## Implementation at checkpoint C01M

**Deliverables:**

| Path | Purpose |
|---|---|
| `tools/migration/src/matching.ts` | Candidate discovery: prior-provenance confirmation, UUID/email/name/unique-key evidence, collisions, stale aliases. Never links or coalesces automatically. |
| `tools/migration/src/merge-plan.ts` | Preview generation (create/update/map/retain/exclude/unresolved per record), decision application, ID mapping, expected-merged-state materialization and invariant validation, plan/snapshot digests, staleness check. |
| `tools/migration/src/resolutions.ts` | Versioned decision-file schema (strict), resolved-plan schema, `resolvePlan`, `verifyResolvedPlan`, decisions template. |
| `tools/migration/src/providers/read.ts` | Read-only canonical reads of one deployment (entity rows via explicit per-kind casts, account/identity inventory) used by planning and later by export. |
| `tools/migration/src/cli.ts` | New `plan` (read-only preview + template) and `resolve` (pure, no database) commands. |
| `tools/migration/tests/migration-merge-plan.test.ts` | 38 tests: matching evidence, conflict choices, protected fields, security decisions, settings, expected-result invariants, staleness and tamper detection, repeated-run provenance. |
| `tools/migration/tests/migration-cli.test.ts` | 5 new CLI tests over `plan`/`resolve`, including a proof that `resolve` never opens a database session. |

**Verification (executed):**

| Command | Result |
|---|---|
| `npx vitest run tools/migration/tests/migration-*.test.ts tests/boundary-enforcement.test.ts` | 114/114 passed (format 19, CLI 40, merge-plan 43, boundary 12) after the review round. |
| `npm test` | 1435 passed, 56 pre-existing integration skips. |
| `npm run typecheck`, `npm run lint` | Pass, no warnings. |
| `npm run test:coverage` | Exit 0; `tools/migration/src` at 86.3% / 76.85% / 89.44% / 87.56%. |
| Boundary rules | Pass (migration modules import no server-only sentinel, request-bound auth module, pool, Next.js module or mail sender; app/script/root code cannot import the tooling). |

**Decisions / deviations recorded:**

1. The plan artifact is self-contained: `snapshot.sourceRows`, `snapshot.targetRows` and the identity inventory are bound into it, so `resolve --plan --decisions --out` is a pure step with **no database access** (tests assert that the session factory is never called) and `apply` can later prove the destination has not drifted via `snapshotDigest`. Plan files are therefore sensitive artifacts and must be protected like bundles.
2. Added `providers/read.ts` and `resolutions.ts` beyond the plan's C01M file list (the plan permits consolidating/adding small helpers); `matching.ts` and `merge-plan.ts` are as proposed.
3. Conflict policy implemented per the plan's conflict table: account and reference candidates are unresolved with allowlisted actions; account/reference candidates allow `map`/`exclude` (`create` is additionally allowed where a separate record can carry a valid unique value, i.e. account-collision, work-data UUID collision and reference rows whose unique key does not actually collide); a previously imported record whose content changed is a review item (`map`/`update`/`exclude`). Supported choices are enforced per conflict, not globally.
4. Destination-only rows are retained; records are never deduplicated by displayed values; absent source rows never imply deletion.
5. Decision files use a `PENDING-REVIEW` placeholder that `resolve` rejects, so a generated template cannot be submitted unreviewed.
6. Protected fields: `id`, `email`, `created_at`, credentials and verification facts cannot be set through field-level decisions; role axes, activation, manager links (`profiles`), `titles.hierarchy_role` and `whitelisted_domains.auto_activate` are reachable only through `security` decisions with a recorded reason. Each security value is validated after materialization.
7. Merged-state invariants cover unique keys (project/activity-type/title names, domain, non-null `telegram_no`, case-insensitive emails, case-insensitive `titles.name` for native's `lower(name)` index), foreign-key closure, manager cycles, role enums, the app_settings singleton, leave uniqueness, hours range and the per-user/day 24-hour cap over the **merged** set. JSON columns are canonicalized when read. Existing destination defects are reported, never auto-repaired.
8. `plan` requires Supabase Auth binding inputs and exits BLOCKED (5) when the binding cannot be verified; `resolve` performs no I/O to any database.
9. `--target-app-version` records the operator-declared target release (default `unverified`), because neither database stores the deployed application version; the plan records source and target migration ledgers and schema fingerprints for review. C00's same-release verification remains an operator task.
10. `expectedResultDigest` is null in a preview that still has unresolved conflicts: no honest expected state exists until they are decided.

**Explicitly not claimed at C01M:** live database merge behavior (constraint triggers, RLS, Auth provisioning), which is the C02 gate; and any production dataset.

### C01M review round (independent read-only review)

A read-only review agent compared the implementation with the C01/C01M plan sections. Findings and resolutions:

| Severity | Finding | Resolution |
|---|---|---|
| P1 | The read layer selected jsonb as `col::text` and `canonicalizeRow` demanded byte-canonical JSON, so `plan` threw on any populated destination (PostgreSQL prints `{"a": 1}`). | `providers/read.ts` now canonicalizes json columns on read (`canonicalizeJsonColumns`) while preserving numeric literals. New CLI test + live proof against the disposable database: PostgreSQL returned `{"a": [1, 2, 3], "b": 2}`, the reader produced `{"a":[1,2,3],"b":2}` (probe row deleted afterwards). |
| P2 | `resolvePlan` trusted `plan.unresolved`: a plan whose conflict list was emptied (digest recomputed) resolved silently. | `applyDecisions` now raises `E_CONFLICT_MISSING` for any entry still marked unresolved without a recorded conflict; covered by a new test. |
| P2 | Merged-state validation missed the `telegram_no` partial unique indexes. | `validateMergedState` now rejects duplicate non-null `telegram_no` on `projects` and `activity_types`; covered by a new test. |
| P2 | Staleness ignored schema and application-version drift (a migration applied to the same server left the snapshot digest unchanged). | `assertPlanFresh` now also compares the live schema fingerprint and, when known, the declared application version; covered by a new test. |
| P3 | Reference-row conflicts could not use the plan's "create separately" choice. | `reference-candidate` now allows `create`; merged-state validation rejects it when the unique value actually collides. New test. |
| P3 | Extra `app_settings` rows produced an unsatisfiable conflict (no entry to decide). | The extra rows now carry their own `exclude` entries; new test proves such a plan resolves. |
| P3 | `--operator` was read by `plan` but not accepted by the flag parser. | `operator` added to the accepted flags. |
| P3 | The read-only statement allowlist accepted `with … insert` / `explain analyze insert`. | Guard now also rejects DML/DDL keywords outside string literals (defense in depth; the session is still `default_transaction_read_only`). |
| P3 | Static boundary scan did not cover `scripts/**` or root modules. | The scan now includes every script except the CLI entry point and all root `*.ts/*.mts` modules. Known limitation recorded: a runtime-composed import specifier cannot be detected by static scanning. |

After the fixes: `npm test` 1435 passed / 56 pre-existing skips, typecheck and lint clean, coverage exit 0 with `tools/migration/src` at 86.3% / 76.85% / 89.44% / 87.56%.

### C01 remediation round (independent C01 review remediation)

An independent review of C01 found six gaps; all have been implemented, tested, and verified:

| Severity | Finding | Resolution |
|---|---|---|
| P1 | Release and schema compatibility were not enforced: preflight and plan accepted any nonempty migration ledger without checking application releases or comparing live schema fingerprints to supported fingerprints. | Added `CURRENT_APPLICATION_RELEASE` ('1.0.3'), `computeCanonicalSchemaFingerprint`, and `REQUIRED_MIGRATIONS` milestone checks to `tools/migration/src/schema.ts`. `preflight` and `plan` now verify `isSupportedApplicationRelease`, `isSupportedSchemaFingerprint`, and `checkMigrationLedger` against target, source, and bundle manifests, returning `E_RELEASE_MISMATCH` / `E_RELEASE_UNSUPPORTED` / `E_SCHEMA_UNSUPPORTED` / `E_LEDGER_INCOMPLETE`. |
| P1 | Timestamp offsets were discarded: `canonicalizeTimestampText` converted timestamps with non-UTC offsets (e.g. `+05:30`) to `...Z` without shifting hours/minutes, mutating instants by the offset amount. | Rewrote `canonicalizeTimestampText` in `tools/migration/src/format.ts` to parse UTC offsets (`+HH:MM`, `-HH:MM`, `+HHMM`, `+HH`, `Z`), compute exact UTC milliseconds via `Date.UTC`, preserve all 6 microsecond digits, and format ISO-8601 UTC strings (`...Z`). Covered by 8 dedicated unit tests. |
| P2 | Declared transformations waived schema type mismatches without verifying that a supported transformation exists. | Added `isSupportedTransformation` (format v1 defines identical schemas across backends, returning false). `checkEntitySchemaCompatibility` now reports `E_SCHEMA_UNSUPPORTED_TRANSFORMATION` when a transformation is declared for an unsupported entity/column and only waives `E_SCHEMA_TYPE_MISMATCH` if a supported transformation exists. |
| P2 | Row limit was checked only after buffer concatenation: streaming in `validateEntityFile` concatenated incoming chunks into `remainder` before checking `BUNDLE_LIMITS.rowBytes` (4 MB), risking unbounded memory consumption on malformed lines. | Enforced `remainder.length + slice.length > BUNDLE_LIMITS.rowBytes` *before* buffer concatenation, immediately recording `E_ROW_TOO_LARGE` and discarding chunk accumulation until the next newline. Covered by unit test. |
| P2 | Native server fallback namespace collision: when `pg_control_system()` probe failed, the fallback namespace used `[provider, projectRef, database, 'no-system-identifier']`, causing distinct native servers on the same database name to collide. | Extracted `computeDatabaseNamespace` in `tools/migration/src/providers/session.ts` to incorporate `target.loopback ? loopback:${port}/${db} : target.displayTarget` when system identifier probe is unavailable, isolating distinct native hosts. Covered by unit test. |
| P3 | Null manifest input threw `TypeError`: `JSON.parse("null")` produced `null`, leading to a crash when accessing `manifest.format`. | Guarded `parsedManifest === null || typeof parsedManifest !== 'object' || Array.isArray(parsedManifest)` to report `E_MANIFEST_SCHEMA`. Covered by unit test. |

After the remediation: `npm test` 1443 passed / 56 pre-existing skips (100% passing), typecheck and lint clean, both Supabase and native builds verified, coverage exit 0 with `tools/migration/src` at 86.28% / 77.41% / 91.07% / 87.6%.


## Implementation at checkpoint C02

**Deliverables:**

| Path | Purpose |
|---|---|
| `db/migrations/0032_migration_receipts.sql`, `supabase/migrations/20260930000000_migration_receipts.sql` | Destination-local `migration_runs` (receipt), `migration_record_map` (provenance) and `migration_identity_journal`; RLS enabled and all PostgREST roles revoked on the Supabase side. Additive to both migration tracks; never part of a bundle. |
| `tools/migration/src/export.ts` | Read-only exporter: one repeatable-read snapshot, canonical rows via the shared reader, exclusive file writes, manifest/provenance digests, and re-exported provenance expressed from the exporting instance's perspective. |
| `tools/migration/src/identity.ts` | Supabase Auth provisioning/adoption, immediate per-identity journaling in its own transaction, lost-response reconciliation by planned id, and cleanup restricted to journal-proven run-created identities. No password, hash, token or verification state ever crosses this boundary. |
| `tools/migration/src/import.ts` | Single destination app-data transaction: provisioning drift allowance, row creates/updates with per-kind casts, reference rewriting through the reviewed id map, mapping + receipt writes, and in-transaction reconciliation against the expected result before commit. Repeat runs with identical digests are a no-op; a reused run id with different digests is refused. |
| `tools/migration/src/providers/supabase.ts` | Auth admin port extended with `findUserByEmail`, `createUser` (id-preserving) and `deleteUser`; deliberately no generic update path. |
| `tools/migration/src/providers/session.ts` | `openWriteSession` for the destination only: writes confined to one `transaction()`, prior-value guard on updates, and a statement guard that rejects data-changing statements outside the transaction. |
| `tools/migration/src/cli.ts` | New `export`, `apply` and `verify` commands with the recorded plan digest, run id and exit codes. Final writer fences are C06B scope. |
| `tools/migration/tests/migration-roundtrip.int.test.ts` | The live V4 slice (see below), including destination enrollment and the late-transaction rollback proof. The enrollment step was added during review and still needs a live rerun. |
| `tools/migration/tests/migration-identity.test.ts`, `tools/migration/tests/migration-import-safety.test.ts` | Recovery regressions for uncertain Auth creation, cleanup ownership, and lost SQL commit responses. |

**Live evidence (executed against disposable services):**

| Case | Result |
|---|---|
| native source → populated Supabase target | Exported 64 rows; plan surfaced the expected account-candidate, reference-candidate and uuid-collision review items; apply committed in one transaction; verify reconciled every entity. |
| Destination-only protection | The destination's project, timesheet and account (id, email, password) survive; the row that owned the colliding UUID is untouched while the incoming record got an allocated id. |
| Credential continuity / enrollment | The seeded account still signs in with its original password after the merge; the new account signs in with no password (fails) and is reachable under the planned id, so it must enroll on the destination. |
| Repeat run | Second `apply` of the same run/digests returned `no-op` and wrote nothing. |
| Later source change | A new source timesheet planned against the same destination maps the previously imported rows through destination receipts (no duplicates) and creates only the new record. |
| Reverse / provenance | Supabase export carried 64 verified aliases; planning back into the native instance surfaced them as reviewed mappings (never automatic), and the reviewed resolution reused every pre-existing native row without recreating anything. |
| Empty-target apply | A second plan against the empty native target was reviewed and applied: reference rows bootstrapped by both providers were mapped after review, work rows were created, and **no credential was fabricated** (`password_hash` count 0). |
| Late-transaction rollback | Injecting a failure at the receipt insert (last statement) rolled back every row change and mapping: no receipt, no mappings, and the adopted account was left untouched. |
| Fail-closed gating | The suite skips with the missing-variable names by default and fails the run when `MIGRATION_TEST_REQUIRE=1`; hosts must be loopback (unless `MIGRATION_TEST_ALLOW_REMOTE=1`) and native database names must match the disposable allowlist. |

Commands: `npx vitest run tools/migration/tests/migration-roundtrip.int.test.ts --no-file-parallelism` with `MIGRATION_TEST_NATIVE_ADMIN_URL`, `MIGRATION_TEST_NATIVE_SOURCE_URL`, `MIGRATION_TEST_NATIVE_TARGET_URL`, `MIGRATION_TEST_SUPABASE_DB_URL`, `MIGRATION_TEST_SUPABASE_AUTH_URL`, `MIGRATION_TEST_SUPABASE_SERVICE_KEY`, `MIGRATION_TEST_SUPABASE_ANON_KEY`, `MIGRATION_TEST_REQUIRE=1`. The suite creates and drops its own disposable databases and removes its own rows/accounts (use `MIGRATION_TEST_KEEP=1` to inspect).

**Decisions / deviations recorded:**

1. Mappings are written under the **import receipt's** run id, not the planning run id: the destination's provenance reader joins map rows to their receipt, so a planning run id would silently break every later reverse/repeat migration. Found by the live slice.
2. Supabase Auth provisioning and the SQL merge are separate transactions, so provider-side effects are journaled immediately; the merge tolerates exactly those journaled profile rows (and their identities) as drift and abandons the run on anything else.
3. New Supabase accounts are created with `email_confirm: false` and no password. A source-side verification fact is recorded for review, never applied; enrollment happens through the destination provider. The seeded known-password account in the test is created with the provider SDK directly, because the migration port deliberately has no password path.
4. `apply` refuses a plan whose reviewed destination namespace differs from the connection, and refuses a reused run id with different digests.
5. The native `titles.id` / `whitelisted_domains.id` text-vs-uuid delta is now accepted for either source provider (the row contract still validates UUID form and the importer casts per live column type); the integer-id path gained an explicit guard instead of producing `NaN` for an invalid allocation.
6. Bundle provenance alone is not sufficient for an automatic mapping: without a destination receipt it is a review item (`untrusted-provenance`). This is stricter than "re-exported provenance maps", so the reverse leg was verified as *reviewed* mapping that still recreates nothing.
7. The late-transaction rollback proof lives in the same live file rather than a separate `tools/migration/tests/migration-recovery.int.test.ts` (harness reuse); the failure is injected by the test's own write-session wrapper, so no test-only hook exists in production code.
8. Verification compares the committed destination against the resolved plan's per-entity digests and checks that the run's receipt exists; the fuller reconciliation matrix belongs to C05.
9. Coverage note: `tools/migration/src` drops to ~73% lines in the unit-only run because export/import/identity are exercised by the live suite, which skips without the disposable services. The aggregate coverage gate still passes.

**Explicitly not claimed at C02:** fencing/retry policy (C06A/C06B), the full entity matrix and streaming diagnostics (C03), complete identity/verification handling (C04), strict reconciliation and durable recovery (C05), and any production dataset. No bulk email was sent and no production system was contacted.

### 2026-09-19 completed-checkpoint review addendum

- C01: bundle rows are rehashed when loaded after offline validation; the planning destination snapshot now reads rows, identities, and receipts in one repeatable-read transaction. Provider-specific schema fingerprints and the receipt migrations are checked. The current shell has no migration connection variables or local database CLI, so it cannot independently repeat the disposable inspection.
- C01M: bundle aliases are advisory; only destination-owned receipts joined to a committed run confirm mappings. The `publication-intent` state now retains that trust after cutover begins. Resolution rejects a second timesheet for the same user/date even when total hours are under 24, matching the database unique index. Two invalid test fixtures were corrected.
- C02: lost Auth creation responses now require the exact planned UUID, email, and `vsis_migration_run_id` Auth metadata before journaling the identity as run-created. Cleanup rechecks the marker and refuses any run with a durable receipt. An uncertain SQL commit now reads the durable receipt before any Auth cleanup; unreadable receipt state blocks cleanup, and a matching committed receipt is reconciled. Apply reads only receipts for the planned source namespace so unrelated sources do not invalidate a plan, while a new same-source mapping does. A `failed` receipt cannot return a completed no-op. These fixes require a fresh disposable live run.
- Current local checks: focused migration/boundary suite 155 passed; full unit suite 1485 passed with 62 integration skips; coverage, typecheck, lint, and both backend builds passed. The Supabase build used the explicit compile-only Auth gate bypass because no live Auth credentials are available in this shell. The expanded recovery unit suite passes 9/9. The six-case C02 live result above predates these recovery changes.
- Remaining C02 PASS evidence: rerun the extended V4 disposable suite with `MIGRATION_TEST_REQUIRE=1` against migrated native and Supabase test services. It now exercises destination enrollment with an admin-generated recovery link after proving that the migration set no password. This tests provider credential setup without sending mail; SMTP readiness remains a separate C00 input. No production connection is needed.
- Concurrency boundary for C06B: the C02 cleanup receipt check and Auth deletion are separate operations. A concurrent apply could commit between them without destination-wide fencing/locking. The C02 disposable slice does not establish concurrent-run safety; C06B must prove the destination lock and writer fences before any production use.

## Implementation at checkpoint C03

**Deliverables:**

| Path | Purpose |
|---|---|
| `tools/migration/src/export.ts` | Rewritten to stream: one repeatable-read, read-only transaction per export with the snapshot id (`txid_current_snapshot()`) recorded in the manifest; per-entity files written through a write stream with exclusive creation and the manifest written last; bytes/counts/digests computed while writing; `E_EXPORT_INTERRUPTED` wraps any mid-stream failure so a partial directory is never importable. |
| `tools/migration/src/providers/read.ts` | `readEntityBatch`: keyset-paginated canonical reads ordered by primary key, comparing UUID-shaped keys as text so the order is total and stable on both providers (native `text` vs Supabase `uuid`). |
| `tools/migration/src/schema.ts` | `EXCLUDED_LIVE_COLUMNS` exported so the exporter's drift diagnostics reuse the single source of truth for provider-internal columns. |
| `tools/migration/src/cli.ts` | `export` reports per-entity batches and the diagnostics block, and journals them with the bundle digest. |
| `tools/migration/tests/migration-export.test.ts`, `tools/migration/tests/migration-export.int.test.ts` | Offline pagination/digest/interruption coverage plus the live V4 volume, value, snapshot-isolation, interruption and diagnostics matrix. |

**Diagnostics contract:** the export never rewrites source records to fit. It reports, instead, the deployed tables outside the canonical matrix, deployed columns the bundle does not carry, canonical columns the deployment lacks, provider storage deltas that are value-compatible (e.g. `titles.id:text` on native), and entities with zero rows. Provider-internal columns (`profiles.role`, `password_hash`, `session_version`, `mobile_password_change_started_at`) are understood, not drift.

**Live evidence:** `npx vitest run tools/migration/tests/migration-export.int.test.ts --no-file-parallelism` with `MIGRATION_TEST_NATIVE_ADMIN_URL`, `MIGRATION_TEST_NATIVE_SOURCE_URL` (disposable `vsis_migration_c03_*`), `MIGRATION_TEST_REQUIRE=1` — 6/6. The suite creates, seeds (1,001 projects, 60 users × 87 days = 5,224 timesheets, boundary and special-character rows), exports, validates and drops its disposable database.

**Decisions / deviations recorded:**

1. Pagination compares UUID-shaped primary keys as text rather than by the column's own type. UUID string ordering differs from `uuid` ordering, but it is total, stable, provider-independent and therefore sufficient for keyset pagination; the exported order is not part of the bundle contract (rows are digested as a set per entity).
2. Diagnostics are reported in the CLI result and the run journal rather than inside the bundle: an extra file in a bundle directory would be rejected by the validator's allowlist.
3. Interruption is simulated in tests by injecting a failing query through a session wrapper; no test-only hook exists in production code.
4. The manifest's `snapshot.transactionId` records the PostgreSQL snapshot id, giving an operator a way to reason about when the exported state existed without adding a new format version.

### C03 review addendum (2026-09-19)

- The committed C03 exporter read catalog/ledger metadata before its row transaction and provenance afterward. A concurrent import could therefore put a post-snapshot mapping into a bundle containing pre-import rows. The worktree fix reads metadata, rows, and committed-receipt-backed provenance in one repeatable-read transaction. A transaction-scoped `to_regclass` probe distinguishes a missing mapping table from a table the source role cannot read.
- The committed provenance read loaded all mappings and serialized one JSON string in memory, with no export-side enforcement of the validator's 64 MiB limit. The worktree fix keyset-pages mapping rows, writes JSON incrementally, and fails before the manifest if the size limit is exceeded. The CLI now consumes the streamed alias count.
- Entity file streams now retain an error listener while the next database batch is in flight. A failed rollback after a lost connection no longer replaces the original export interruption error. Diagnostics now count source rows that violate the known shared destination checks for leave reason, reminder message, and timesheet hours without rewriting those values.
- Focused offline exporter/CLI/session tests pass 71/71, including new provenance pagination, interruption, and incompatible-value cases. The final full coverage run passed 1,496 tests with 68 skips and met aggregate thresholds; typecheck, lint, and diff checks pass. The earlier C03 live 6/6 result predates these fixes; the live suite skips in the fix author's shell because `MIGRATION_TEST_NATIVE_ADMIN_URL` and `MIGRATION_TEST_NATIVE_SOURCE_URL` are unavailable. The rerun was executed later on `ef06a23` (see "Independent verification of the landed slice").
- **Remaining PASS gates:** the rerun executed on `ef06a23` (`MIGRATION_TEST_REQUIRE=1`, 6/6), including the suite's independent source counts and order-insensitive canonical digests for every entity. Record the C06A operational-state/session/retry contract required by the implementation plan before finalizing the exporter. Target-specific value compatibility still needs destination preflight, and approved Auth metadata coverage must be reconciled with C04 rather than silently claimed by the exporter.

### Implementation review round — 2026-09-19 (post-C03 read-only review + fixes)

An independent read-only review compared the committed C01–C03 implementation with the plan and confirmed two executable planner defects, one ledger-accuracy problem and several contract gaps. All code findings below are fixed in this worktree with tests; the ledger corrections are applied to this file.

| Severity | Finding | Resolution in this worktree |
|---|---|---|
| P1 | `E_TIMESHEET_DUPLICATE_DAY` rejected any second timesheet for one user/day, but `db/migrations/0005` dropped that unique index and the plan requires equal-looking timesheets to stay separate. | Removed the false invariant; only the 24-hour cap over the merged set is enforced. The old test asserted the wrong behavior and now proves the opposite (two rows kept, plan resolves). |
| P1 | Two distinct source records could be mapped onto one destination row (silent coalescing) — preview allowed duplicate proposals, decisions never checked destination claims, materialize had no backstop. | Destination-claim uniqueness at three levels: preview emits a `destination-claimed` conflict (exclude-only) for the second contender; decision application rejects a second map/update onto a claimed row (`E_DESTINATION_CLAIMED`) and requires a recorded reason for retargeting; materialize re-checks the final id map. Coalescing is expressed only by mapping one record and excluding the other with a reason. |
| Ledger | The C02 status row claimed the live rerun covered the Auth run-marker and durable-receipt recovery paths; both exist only behind unit mocks. | Status row corrected: core slice live-proven, the two recovery paths explicitly marked mock-only with a live rerun as remaining evidence. |
| Dependency | C03 was marked PASS while its declared C06A dependency had not started. | Already corrected in this worktree (C03 BLOCKED pending live rerun + C06A); kept consistent here. |
| P2 | Case-insensitive `titles.name` uniqueness was enforced for both providers although only native has the `lower(name)` index. | `validateMergedState` now takes the destination provider and enforces the case-insensitive check for native only; covered by both-provider tests. |
| P2 | `apply` never compared the application release bound into the plan. | `applyResolvedPlan` now requires the operator-declared release (CLI `--target-app-version`, defaulting to the running tool's `CURRENT_APPLICATION_RELEASE`) to equal `plan.target.applicationVersion`, else `E_RELEASE_MISMATCH`. Covered by unit tests. |
| P2 | Decimal aggregation used lossy JavaScript numbers (plan §3 forbids it). | `addDecimal` and the hours/cap math now use exact BigInt fixed-point arithmetic; values beyond the supported scale fail closed (`E_VALUE_INVALID`). `tsconfig` target moved ES2017 → ES2020 for BigInt literals (type-check only; Next builds are unaffected). Covered by a precision test. |
| P2 | Rollback proof asserted only receipts/mappings, not the app-data rows. | The live rollback case now captures per-entity row counts before the failing apply and asserts every entity is unchanged after rollback. |
| P2 | `E_TARGET_MISMATCH`, stale-plan-before-provisioning and release enforcement had no tests. | New unit cases: wrong destination namespace fails before any transaction; a drifted baseline fails `E_STALE_PLAN` with zero Auth calls and zero transactions; release mismatch/enforcement covered. |
| P2 | Schema-matrix tests were self-referential (fingerprint derived from the same spec the tests build). | New `tools/migration/tests/migration-schema-matrix.test.ts` parses both migration trees and asserts every live column is contracted-or-excluded and every contract column exists on both providers. |
| P3 | Error-cap overflow produced misleading secondary count/size/digest failures; `migration_*` tables were silently exempt from drift diagnostics by prefix; statement limits were invisible in the export result; `readReceipt` used `select *`; the Supabase test database had no remote-host guard. | Cross-checks are skipped once the collector overflows; diagnostics exempt exactly the three receipt tables; `ExportResult.statementLimits` (from `SESSION_STATEMENT_LIMITS`) is surfaced in the CLI result; receipt reads use explicit columns; `MIGRATION_TEST_ALLOW_REMOTE_SUPABASE=1` is now required to run the Supabase target against a remote host. |
| Accepted (no change) | Supabase ledger prefix tolerance accepts a same-timestamp different-suffix migration; `app_settings` re-surfaces as a conflict on repeat runs unless unchanged. | Timestamps are the unique migration key so the prefix branch only tolerates suffixed fixtures; the unchanged singleton now carries over as a proposed map, and a *changed* singleton stays a reviewed conflict (fail-closed by design). |

After the fixes: focused migration suites and the boundary/mobile-guard/supabase-migrations suites pass; typecheck and lint are clean; the live suites still require the disposable services (skipped in the fix author's shell; the second reviewer executed them live on `ef06a23`, see below). The plan artifacts and digests are unaffected by these changes only for freshly generated plans; previously saved preview artifacts must be regenerated.

### Independent verification of the landed slice (second reviewer)

The review slice above was verified on the settled tree, and the live gates were executed rather than skipped:

| Finding | Resolution |
|---|---|
| `npm run typecheck` failed with two errors in `tools/migration/tests/migration-merge-plan.test.ts` (an `ExpectedResult` cast and a possibly-null `resolvedPlan`); the unit suite hid them because vitest does not typecheck. | Fixed in the test (cast through `unknown`; explicit null narrowing). |
| **`plan` produced a plan that `resolve` rejected** (`E_PLAN_SCHEMA`): the new `destination-claimed` kind existed in `ConflictKind`/`conflictActions` but was missing from the resolution JSON schema's enum. In-process unit tests cannot see this; the live CLI round trip does. | Added `destination-claimed` to `unresolvedConflictSchema` in `resolutions.ts`. |
| The reverse live leg assumed every conflict allows `map`, while `destination-claimed` deliberately allows only `exclude`. | The live test now maps when allowed and otherwise takes the first allowed action, recording a reason either way. |

After the fixes, on revision `ef06a23`: typecheck and lint clean, unit suite 1512 passed / 68 skipped, live round-trip 6/6 and live export 6/6 against the disposable native databases and the local Supabase stack. The live round-trip suite drives five `plan` invocations, each with an explicit `--target-app-version` (populated Supabase target, later-source-change plan, reverse leg, empty native target, rollback proof).

### Follow-up remediation round — 2026-09-19 (verification findings)

A read-only verification of the section above reproduced the local suites (1,512 passed / 68 skipped; typecheck and lint clean) and raised five findings. All are resolved in this worktree:

| Severity | Finding | Resolution |
|---|---|---|
| P1 | `session.identity()` ran inside the exporter's repeatable-read transaction; a restricted source role cannot execute `pg_control_system()`, and PostgreSQL leaves the transaction aborted after the permission error, so the following catalog queries failed with `25P02`. | Both sessions now probe under a transaction-scoped savepoint (`vsis_system_identifier_probe`) and roll back to it on failure, so the snapshot survives a denied probe. The read session is covered by `tools/migration/tests/migration-session.test.ts` (denied probe inside and outside a transaction). |
| P1 | The exporter tracked entity bytes but never enforced the validator's 4 MiB row / 8 GiB entity limits, so oversized source data produced a manifest that validation then rejected. | `streamEntity` fails closed with `E_ROW_TOO_LARGE` / `E_ENTITY_TOO_LARGE` before the manifest is written; the provenance cap keeps its own `E_PROVENANCE_TOO_LARGE` code instead of being wrapped as an interruption. `ExportRequest.limits` lets tests exercise the bounds. Covered by `tools/migration/tests/migration-export.test.ts`. |
| P2 | This ledger was internally inconsistent: it claimed the revised live export passed while marking the rerun pending, called the committed fixes "uncommitted", pinned no revision, and omitted the C03 plan dependency on approved Auth metadata coverage. | Corrected here: evidence is pinned to `ef06a23`; the status row, remaining-work item and outcome statement now agree that the live rerun executed on that revision and that C03 stays BLOCKED on C06A plus approved Auth metadata coverage. |
| P3 | The proposed conflict-kind schema test could not have caught the reported regression (`destination-claimed` missing from the resolution schema): the schema was private and the test listed kinds manually. | `CONFLICT_KINDS` in `tools/migration/src/merge-plan.ts` is now the single source for `ConflictKind` and the resolution schema enum, with an `Exclude`-based assertion plus per-kind parse coverage in `tools/migration/tests/migration-merge-plan.test.ts`. |
| P3 | Verification text stated four `plan` invocations in the live round-trip suite; the suite contains five, each with `--target-app-version`. | Corrected above (five: populated Supabase target, later-source-change plan, reverse leg, empty native target, rollback proof). |

The two exporter fixes land after `ef06a23`, so the live 6/6 evidence above does not cover them; their evidence is the focused offline suites only, and a live rerun is still expected with the eventual C03 PASS once C06A and approved Auth metadata coverage are settled. A rerun on the current revision (with the restricted-role `25P02` and row/entity-limit fixes in the tree) passed `tools/migration/tests/migration-export.int.test.ts` 6/6 and `tools/migration/tests/migration-roundtrip.int.test.ts` 6/6, so the follow-up changes are live-verified even though the checkpoint's PASS still depends on C06A.

## Implementation at checkpoint C04

**Deliverables:**

| Path | Purpose |
|---|---|
| `tools/migration/src/identities.ts` (new) | Pure identity-disposition module. One disposition per source account (`mapped`, `provision`, `historical`, `excluded`), per-account enrolment status, the ids that may be handed to the Auth provider, and the blockers that must stop an apply. |
| `tools/migration/src/import.ts` | `apply` now runs the disposition before any provider call and fails on any blocker; provisioning is filtered through the disposition's `provisionIds`, so a historical reference or an excluded account can never reach the provider; the reviewed source verification fact is carried for review instead of being dropped; the result records the disposition/enrolment summary. |
| `tools/migration/src/providers/read.ts` | Supabase identity inventory now also reads the sign-in providers attached to each account (aggregated from `auth.identities`) so an OAuth-only source account is visible to review. |
| `tools/migration/src/resolutions.ts` | The plan-snapshot schema accepts the optional `providerIdentities` fact (older plans simply lack it). |
| `tools/migration/src/cli.ts` | `apply --json` surfaces `identityDispositions`. |
| `tools/migration/tests/migration-identities.test.ts` (new) | 9 tests: dispositions and enrolment separation, inactive/administrator/unverified accounts, historical deleted actors, undisposed accounts, exclusions with and without dependents, missing email, incomplete mapping, OAuth-only blockers, and matched accounts that keep their identity. |

**What the blockers are:**

1. `E_IDENTITY_UNDISPOSED` — a source account, or an account referenced by imported rows, has no reviewed map/create/exclude decision.
2. `E_EXCLUDED_WITH_DEPENDENTS` — an excluded account is still referenced by rows this run imports; the exclusion cannot stand until its dependents are resolved.
3. `E_IDENTITY_UNMAPPED` / `E_IDENTITY_NO_EMAIL` — a mapping without a destination identity, or a new account that could not enroll.
4. `E_IDENTITY_UNSUPPORTED_PROVIDER` — the account signs in through a provider other than email; creating a password account would downgrade its assurance, so it needs an explicit reenrollment decision or an exclusion.
5. `E_HISTORICAL_PROVISIONED` — defense in depth: an id with no source account must never appear in the provisioning list.

**Enrolment is recorded separately from the data import:** `existing-account` (a matched account keeps the destination credential), `enroll-on-destination` (a new account enrolls through the provider; nothing is transferred), `not-an-account` (historical reference — never a login). The apply result and journal carry the counts, the provisioned ids and the historical ids. The status string avoids the word "credential" because the run output's redaction rules correctly mask such keys; naming it `existing-account` keeps the fact readable without weakening redaction.

**Live evidence (this revision):** `tools/migration/tests/migration-roundtrip.int.test.ts` 6/6 (disposition summary `mapped: 1, provision: 1, historical: 0`, `existing-account: 1`, `enroll-on-destination: 1`, provisioned exactly the approved new account; the matched account still signs in with its original destination password before and after the merge; the new account cannot sign in with any guess and enrolls through a provider-issued recovery link), `tools/migration/tests/migration-export.int.test.ts` 6/6, unit suite 1526 passed / 68 skipped, typecheck and lint clean.

**Remaining C04 scope (not claimed above):**

1. **The deleted-actor path is unit-covered, not live.** The schema makes a stale live reference impossible today: `audit_logs.actor_id` is `references public.profiles(id) on delete set null`, and every other profile reference is `not null`, so a reference to a nonexistent profile cannot be inserted. The rule still matters for a deployment or bundle where that constraint was absent, which is what the unit test covers.
2. **Domain-whitelist behavior is asserted, not exercised end to end**: the live suite proves the whitelisted domain row survives the merge with `auto_activate = false` and that the reviewed active state is applied, but it does not run a signup through the application's own gate. That gate is covered by `tests/supabase-live-registration.int.test.ts` (4/4 on this revision).
3. **Second-factor *enrollment* is not executed**, only detected: an account with `auth.mfa_factors` rows now blocks provisioning (`E_IDENTITY_MFA_UNSUPPORTED`), but no test enrolls a factor and re-runs the migration.

**Verification performed for this checkpoint (this revision):**

- `tools/migration/tests/migration-identities.test.ts` 10/10 (dispositions, enrolment separation, inactive/administrator/unverified accounts, historical references, undisposed accounts, exclusions with/without dependents, missing email, OAuth-only blocker, second-factor blocker, matched-account update).
- `tools/migration/tests/migration-roundtrip.int.test.ts` 6/6 (disposition/enrolment summary; matched account signs in with its original destination password before and after the merge; new account cannot sign in with a guessed password and enrolls through a provider-issued recovery link; destination `sync_legacy_role` trigger keeps `role` consistent with the permission/hierarchy axes for both imported profiles; whitelisted domain row survives with `auto_activate = false`).
- Backward compatibility: `tests/supabase-live-registration.int.test.ts` 4/4 (signup gate), `tests/supabase-live-rls.int.test.ts` + `tests/supabase-live-recovery.int.test.ts` 13/13 (RLS and recovery), and the native auth flows through the unit suite.
- Repository: typecheck and lint clean; unit suite 1527 passed / 68 skipped; `tools/migration/tests/migration-export.int.test.ts` 6/6.

### C04 review round — 2026-09-19 (verification findings)

A read-only verification of the C04 implementation raised five findings; all were fixed in that worktree. The two that changed the reviewed artifacts (the source identity inventory and the partial-provisioning report) meant the live evidence available at that review point no longer covered the code, so C04's PASS was suspended pending a live rerun. That historical suspension was resolved by the 2026-09-21 live recovery result below.

| Severity | Finding | Resolution |
|---|---|---|
| P1 | Source OAuth/MFA assurances were never captured: the plan stored *destination* identities, C04 read them as source facts, and the bundle carried no Auth inventory, so an OAuth-only source account could be provisioned as a password account. | The export now captures the source inventory under the same repeatable-read snapshot as `identities.json` (count/bytes/sha256 in the manifest, optional so older bundles stay readable), the validator re-reads it into `sourceIdentities`, `plan` binds it into `snapshot.sourceIdentities`, and `buildIdentityDispositions` reads only those facts. A `create` with no source record fails closed (`E_IDENTITY_INVENTORY_MISSING`). This uses the same approved Auth relations as the destination read (`auth.users`, `auth.identities`, `auth.mfa_factors`). |
| P1 | Partial identity provisioning was hidden: a failing later account returned an empty failure result, left earlier run-created accounts behind and dropped the earlier outcomes. | The failure path now reads the run's identity journal, reports those outcomes in `identityProvisions`, records them in the disposition summary, and removes only journal-proven run-created accounts (`identityDispositions.cleanedUp`) since no app-data receipt can exist yet. Covered in `tools/migration/tests/migration-import-safety.test.ts`. |
| P1 | A missing `auth.mfa_factors` broke the planning transaction: the `42P01` catch left the transaction aborted, so the next query failed with `25P02`. | `readMfaFactorCounts` probes `to_regclass('auth.mfa_factors')` first instead of catching the error, so the compatibility fallback never issues a failing statement inside the snapshot. Covered by `tools/migration/tests/migration-identity-inventory.test.ts`. |
| P1 | Destination provider/MFA drift was invisible to the stale-plan check: `deploymentSnapshotDigest` omitted `providerIdentities` and `mfaFactors`. | Both facts are now part of the identity line in the digest, so an account gaining an OAuth provider or a second factor invalidates a reviewed plan. Covered in `tools/migration/tests/migration-merge-plan.test.ts`. |
| P2 | The deleted-actor path could not complete an apply: `identities.ts` classified a referenced id as historical while merged-state validation rejected the same reference as `E_FK_ORPHAN`. | The historical classification now requires the merged result to hold the referenced profile (a retained destination row). Otherwise the disposition fails closed with `E_HISTORICAL_UNRESOLVED` and tells the operator to exclude the referencing rows or correct the source, instead of failing later as an unattributed orphan. Covered in `tools/migration/tests/migration-identities.test.ts`. |

**Evidence for round 1 (offline, at the time):** `tools/migration/tests/migration-identities.test.ts` 12/12, `tools/migration/tests/migration-export.test.ts` 11/11, `tools/migration/tests/migration-cli.test.ts` (validate + plan additions), `tools/migration/tests/migration-import-safety.test.ts` 10/10, `tools/migration/tests/migration-identity-inventory.test.ts` 3/3, `tools/migration/tests/migration-merge-plan.test.ts` (digest case); typecheck and lint clean; full unit suite 1545 passed / 68 skipped. A later independent verification re-ran the live suites on the revision carrying these fixes (see the C04 row: round-trip 6/6, export 6/6), so round 1 is live-covered. The second review's own identity findings are recorded in "C04 review round 2" below.

## Implementation at checkpoint C06A — historical decision record

The contract lives in `docs/plans/archive/C06A_RETRY_SESSION_RECOVERY_CONTRACT.md`. The original decision record below is superseded by the 2026-09-20 implementation review: portable committed/uncertain history is implemented, while never-committed queue provenance remains blocked.

**Repository-settled decisions (usable by C03/C05/C06B now):**

1. **One retry contract matters**: the mobile/sync path through `withIdempotency`, keyed by the client's stable mutation id with a server-side committed effect and canonical payload hash. Web actions, direct provider calls and outbound integrations are fenced, disabled or out of scope, and the inventory with code references is in the contract.
2. **Implemented subset:** digest-bound portable committed/uncertain outcomes are exported, imported and matched by deployment namespace and exact fingerprint. Automatic forward translation is blocked when a never-committed request contains a remapped source id because current clients provide no authenticated source namespace/timestamp.
3. **Horizon:** server retention remains 97 days against the client's 90-day park threshold; cleanup continues with that floor.
4. **Field matrix correction:** `retry-history.json` and protected `migration_retry_history` tables are required. The earlier claim that no portable record was needed was false and is superseded.
5. **Session property over mechanism:** old credentials must not authenticate after publication, and the contract requires proof per direction rather than assuming it from a password reset or a restore. Matched destination credentials are preserved (C04 evidence).
6. **State machine:** `planned → resolved → auth-provisioned → data-committed → verified → publication-intent → writable`, with the crash behaviour of each transition written down and receipt-driven recovery instead of blind re-runs.
7. **Recovery:** pre-publication restores the verified destination baseline and resumes both original deployments; post-publication exports the merged authority into a reserved recovery destination of the original provider, and the retained source is explicitly rejected as a recovery source.

**Historical operator-decision snapshot (2026-09-23; superseded by the 2026-10-03 reconciliation):** the 90-day client horizon and 97-day retention remain binding. The later reconciliation pauses scheduled cleanup during the final fenced window, selects existing Supabase project `timesheet-test` as the original-provider recovery target for the first Supabase → native direction, and retains Docker native as primary. The earlier apply-window-plus-24-hour observation assumption is not a substitute for C08's declared/measured window. SMTP/enrollment-wave readiness remains open outside the retry contract.

**Current consequence:** C03, C05 and C06A remain BLOCKED on their revised live/evidence gates and the never-committed queue provenance limitation. C06B's fence and verified publication transitions are implemented but still need their V6/live matrix.

## Implementation at checkpoint C05

### Task 3 — declared permissible differences

The reconciler compares **canonical** rows, and the canonical reader rejects any column the entity matrix does not declare (`E_COLUMN_UNKNOWN`). Everything below is therefore invisible to reconciliation *by construction* rather than by a tolerance list:

| Difference | Mechanism | Why it is permissible | Guard |
|---|---|---|---|
| Legacy role column (`profiles.role`) | `sync_legacy_role` writes `new.role` on every profile insert/update, in both tracks | `profiles.role` is provider-internal, excluded from the bundle and absent from the entity matrix | `tools/migration/tests/migration-permissible-differences.test.ts` asserts the trigger assigns exactly `role` and that the column is excluded |
| Native credential/session state (`password_hash`, `session_version`, `mobile_password_change_started_at`) | Written by the application, never by the merge | Excluded from the bundle; a new account is created without a credential and enrolls on the destination | Same suite: excluded set equals the declaration, no excluded column appears in the entity matrix, and adding one to a row throws |
| Provider-generated bookkeeping on the row (e.g. a mobile idempotency marker) | `private.mobile_idempotency_claim/commit` triggers write provider-local tables; any row-level marker would be a column the matrix does not declare | Either it is not on the bundle entity at all, or the reader refuses the row instead of folding it into a digest | Same suite: an undeclared column on `profiles`/`timesheets` throws `MigrationFormatError` |
| Daily-hours constraint | `check_daily_hours_limit` only raises `check_violation` | It validates, it does not modify | Same suite: the trigger body contains `raise exception` and performs no assignment |
| Schema bootstrap rows (reference rows created by migrations) | Present in both deployments; the plan reviews them as conflicts when names or keys collide | They are normal rows the reviewed plan accounts for, not a hidden difference | `tools/migration/tests/migration-merge-plan.test.ts` covers reference-row collisions |
| Auth bootstrap profile (`on_auth_user_created`) | Creating an Auth user also creates a profile row with defaults | It is a *recorded* provisioning effect: the importer tolerates exactly those ids between preflight and commit (`toleratedProfileIds`, `baselineDrift`) and the disposition plan accounts for each identity | `tools/migration/tests/migration-import-safety.test.ts`; live round trip asserts the created profile ends in the approved state |
| Sequence/identity counters (`app_settings.id`) | PostgreSQL sequences advance independently of committed rows | Counters are not rows; the matrix carries the declared ids | `tools/migration/tests/migration-merge-plan.test.ts` (integer-id allocation and conflict reporting) |
| Imported audit history | `audit_logs` is a bundle entity, imported as data | It is data, not a generated field | `tools/migration/tests/migration-format.test.ts` |

**Delivered artifact:** `tools/migration/tests/migration-permissible-differences.test.ts` (6 tests). Its first test pins the declaration to `EXCLUDED_LIVE_COLUMNS`, so a code change that adds or removes an excluded column fails until the declaration above is updated — the contract cannot silently drift away from the implementation.

### Task audit against the implemented importer

| Task | Status |
|---|---|
| 1 — consume bundle/plan/identity results, recheck digests and baseline | Implemented in the C02 importer (schema fingerprint, plan digest, destination snapshot digest, receipt); the **write fences and destination lock are C06B**, per the plan's own split |
| 2 — dependency-ordered creates/updates, one transaction, reference rewriting, no deletions | Implemented (`applyEntries` with batched parameterized writes, `idMap` rewriting, destination-only rows retained) |
| 3 — permissible differences declared | **Delivered by this checkpoint** (table above + guard suite) |
| 4 — reject unresolved/unknown/stale/unauthorized inputs, persist exclusions with reasons | Implemented (`verifyResolvedPlan`, decision-file schema, `validateMergedState`, exclusion reasons carried into the dispositions) |
| 5 — compare the full expected union, not raw counts | Implemented (`reconcile` compares per-entity digests of the entire merged result, and `verify` reports the diff). The plan's wider V4 matrix (populated/empty targets, every resolution type, forged resolutions, later-bundle runs) is **not yet complete** |
| 6 — atomic commit of data + mappings + receipt, receipt decides lost responses, rollback removes all three | Implemented (single transaction; `readReceipt` distinguishes `E_COMMIT_UNCERTAIN`; mappings are written with the receipt's run id) |
| 7 — repeat is a no-op, reused run ids with different digests are rejected, later legitimate edits distinguished | Partly: the no-op and `E_RUN_ID_REUSED` paths exist, and self-rehash detection covers a destination edited after the merge; the "different bundle through a new reviewed plan" path and the "later edits vs corrupt commit" distinction still need their V4 cases |
| 8 — publication separate from import success | Implemented as receipt state (`data-committed` → `verified` → `publication-intent` → `writable`); the write gate itself is C06B |

**Next C05 work:** the V4 matrix expansions for tasks 5 and 7 (populated and empty targets, every resolution type, forged resolutions/provenance, repeated completed and later-bundle runs, and failure injection across commit boundaries), followed by the checkpoint's PASS assessment.

### Whole-program review round — 2026-09-19 (second verification)

A second read-only verification reviewed all checkpoints at `e397980` and raised eighteen findings. The defects that are fixable in the tooling are fixed in this worktree with offline evidence; the checkpoint-scoped gaps are recorded as open below. No live suite was rerun for these changes.

| # | Checkpoint | Finding | Resolution in this worktree |
|---|---|---|---|
| 1 | C01 | The namespace fallback hashed the connection text, so aliases/proxies in front of one server looked like two instances. | Durable namespaces now require `pg_control_system()` identity or a verified Supabase project reference. Boot-time fallback facts are used only for within-run diagnostics; unverifiable durable identity fails closed. Covered in `tools/migration/tests/migration-cli.test.ts`. |
| 2 | C01 | Duplicate identity records were accepted and collapsed last-write-wins. | `identitiesFileSchema` rejects duplicate ids (`E_IDENTITIES_SCHEMA`) and `buildIdentityDispositions` blocks `E_IDENTITY_DUPLICATE` instead of indexing them. |
| 3 | C01 | `2026-02-31` and hour `25` passed validation. | Date/timestamp values are calendar-checked in `checkValue` (`E_VALUE_INVALID`), leap years preserved. |
| 4 | C01M | `matchingRulesVersion` was recorded but never enforced. | `resolvePlan` and `verifyResolvedPlan` fail with `E_MATCHING_RULES_UNSUPPORTED` when the plan's rules version differs from the running release. |
| 5 | C01M | The resolved-plan operator/timestamp were not integrity-bound. | `resolutionDigest` now binds `operator`; editing it invalidates `verifyResolvedPlan`. |
| 8 | C04 | Source Auth accounts without profile rows received no disposition. | `E_IDENTITY_WITHOUT_PROFILE` blocks until each such account is removed or explicitly decided. |
| 9 | C04 | Auth and profile emails were not cross-validated. | `E_IDENTITY_EMAIL_MISMATCH` blocks a profile whose email differs from its Auth record. |
| 10 | C04 | Destination drift after provisioning left created Auth users behind. | The post-provisioning drift return reports the partial outcomes and removes run-created accounts (`cleanedUp`); the transaction-failure return now reports them too. |
| 11 | C04 | A successful creation whose journal write failed left an untracked account. | `journalCreatedOrRemove` deletes the account when its journal entry cannot be written, and `cleanupRunIdentities` additionally sweeps accounts carrying the run marker. |
| 13 | C05 | A matching receipt accepted corrupted state without live reconciliation. | The no-op and durable-receipt paths reconcile rows and verify every durable source→destination mapping (`E_MAPPING_MISSING`/`E_MAPPING_MISMATCH`/`E_MAPPING_UNEXPECTED`) before reporting success. |
| 17 | C06A | The contract contradicted itself on cleanup policy. | §1 now matches the binding §8 decision: the cleanup keeps running; retention is never shortened below 97 days. |
| 18 | ledger | The C04 status row and the review-round sections contradicted each other. | Status rows and round sections reconciled in this file. |

**Superseded historical note — C04 review round 2 (identity-path findings, 2026-09-19):** this second verification reported the four findings and resolutions listed as #8–#11 in the table above. Its evidence was offline only at the time, so C04 was temporarily suspended pending a live rerun. The suspension is resolved by the 2026-09-21 live recovery result recorded in the current C04 row and the recovery section below; this paragraph remains as the historical review record. One fixture constraint remains relevant: `E_IDENTITY_WITHOUT_PROFILE` fails closed on any source Auth account without a profile row, so a shared disposable Supabase stack must not contain unrelated orphan Auth users created by other suites (the round-trip suite's own fixtures all carry profiles).

**2026-09-20 status of the formerly open checkpoint items:**

1. **C03 #7 / C06A #15:** committed and uncertain outcomes are portable and fail closed; never-committed requests with remapped source ids remain blocked for manual review because source provenance is absent.
2. **C05 #12:** fixed by the durable write gate and the apply transaction's first-statement row lock.
3. **C06A #16:** fixed for implemented transitions: reconciliation persists `verified`, publication requires it, and admission records `writable` atomically with opening the gate.
4. **C05 #14:** fixed by paired `migration_record_dispositions` migrations and exact post-commit reconciliation.

**2026-09-20 adjudicated review fixes (priority order; uncommitted in this worktree):**

| # | Finding | Fix |
|---|---|---|
| 5 | Database identity depended on connection privileges (`system_identifier` vs project/fallback). | `runtimeFingerprint` is built from server facts only (postmaster start + version), so direct, pooled, privileged and restricted connections to one database share it. The bundle manifest records it (`source.runtimeFingerprint`, optional), `plan` compares it for the self-import check, and `apply` compares it against the reviewed target. Covered in `tools/migration/tests/migration-cli.test.ts` and `tools/migration/tests/migration-import-safety.test.ts`. |
| 13 | Settings selections applied even when the source singleton was excluded. | `materialize` refuses the combination with `E_SETTINGS_EXCLUDED`. Covered in `tools/migration/tests/migration-merge-plan.test.ts`. |
| 16 | Unexpected errors printed unredacted. | `runCli`'s catch-all and the `CliFailure` message pass through `redactString`, and `REDACT_KEY_RE` covers `apiKey`/`accessKey`/`serviceRoleKey`/`authorization`/`bearer`/`jwt`. |
| 4 | `assertReadOnly()` treated any probe failure as proof of read-only mode. | It now requires SQLSTATE `25006`; permission and pre-existing-object errors fail closed as `E_SOURCE_WRITABLE`. Covered in `tools/migration/tests/migration-session.test.ts`. |
| 2 | The statement allowlist could be desynchronized by quotes in comments and allowed `set_config`. | A hand-written scanner strips comments/literals/dollar-quotes, refuses multi-statement input, and blocks `set_config`/`pg_reload_conf`/`pg_terminate_backend`/`pg_cancel_backend`/`lo_import`/`lo_export`/`dblink`. Covered in `tools/migration/tests/migration-session.test.ts`. |
| 1 | A missing gate table aborted the apply transaction (`25P02`) instead of using the documented older-database fallback. | `lockWriteGateForApply` probes under `vsis_write_gate_probe` and recovers with `rollback to savepoint`; the apply proceeds on a deployment without the gate. Covered in `tools/migration/tests/migration-c05-recovery.test.ts`. |
| 6 | Merged values were only type-checked, and the UUID rule was stricter than the bundle contract. | `validateMergedState` re-runs `canonicalizeRow` per row (calendar validity, canonical JSON, decimal text) and uses the bundle's `UUID_RE`. Covered in `tools/migration/tests/migration-merge-plan.test.ts`. |
| 3 | The embedded target snapshot was not compared with `target.snapshotDigest`. | `resolvePlan`/`verifyResolvedPlan` fail with `E_SNAPSHOT_DIGEST_MISMATCH` when the embedded snapshot does not hash to the reviewed digest. Covered in `tools/migration/tests/migration-merge-plan.test.ts`. |
| 7 | No-op verification filtered mappings by `run_id`, so a later run's relabeling broke an older run's repeat. | `verifyMappings` checks the reviewed pairs by `(entity, source_id)` against the current mapping table and ignores rows owned by other runs. Covered in `tools/migration/tests/migration-import-safety.test.ts`. |
| 9 | `REQUIRED_MIGRATIONS` was not tied to the files on disk. | `tools/migration/tests/migration-schema-matrix.test.ts` asserts every required migration exists in both trees. |
| 12 | `verifyResolvedPlan` could not reuse an injected allocator. | It accepts `{ allocatedId }` and forwards it to `applyDecisions`. |
| 14 | Extra source `app_settings` rows received both a create and an exclude entry. | Only the singleton is matched; extras are exclusions, so counts and artifacts agree. Covered in `tools/migration/tests/migration-merge-plan.test.ts`. |
| 17 | Blocked/security refusals exited as environment or validation failures. | `describeError` maps operator-actionable run codes (`E_WRITERS_NOT_FENCED`, `E_GATE_MISSING`, `E_PUBLICATION_STATE`, `E_RECEIPT_MISSING`, `E_AUTH_REQUIRED`, `E_SESSION_WRITE_BLOCKED`, `E_SOURCE_WRITABLE`, `E_WRITE_ROLE`, `E_INSTANCE_IDENTITY_UNAVAILABLE`) to `BLOCKED` (5). Covered in `tools/migration/tests/migration-cli.test.ts`. |

Accepted without change (per the adjudication): the Supabase receipt migration's bare `create policy` (an applied migration must not be edited), the resolved-plan format sharing `MERGE_PLAN_FORMAT_VERSION`, and `assertPlanFresh` (redundant with the digest comparisons but retained and tested). Deferred with rationale: wiring the live `.int` suites into CI (needs disposable services; manual live runs stay recorded here) and the resolve/export ancestor-bundle guard (a contaminated bundle is rejected later, and an ancestor `manifest.json` check risks false positives).

## Implementation at checkpoint C06B (partial)

**Delivered: the durable fence and the operator transitions.**

| Path | Purpose |
|---|---|
| `db/migrations/0033_migration_write_gate.sql`, `supabase/migrations/20261001000000_migration_write_gate.sql` | Single-row gate: `state` (`open`/`fenced`), `run_id`, `reason`, `updated_at`, `updated_by`. In Supabase, RLS is enabled with a read policy for `authenticated` and **no** write policies, plus the explicit `revoke all on table … from public, anon, authenticated` form the mobile-session guard suite requires — ordinary users can read the gate but never set it. |
| `tools/migration/src/gate.ts` | `readWriteGate` / `isWriteGateFenced` (with the process cache that makes enforcement affordable), `setWriteGate` (transition inside one transaction, reason required), `writeGateRefusal` (503 + `WRITERS_FENCED` + retry-after). A missing gate table reads as "no gate"; any other read failure is surfaced so a broken gate is never mistaken for an open one. |
| `tools/migration/src/cli.ts` | `migration gate --target … [--state open\|fenced --reason … --actor … --run-id …] --json` — the recorded operator transition, with the current state and its reason reported back. |
| `tools/migration/tests/migration-gate.test.ts` | 6 tests: reading the state, a deployment with no gate reading as open, a broken read propagating, the cache window and per-deployment cache keys, a transition writing one transactional row and refusing an empty reason, and the refusal shape. |

**Live evidence:** the native migration applies cleanly on the disposable database the export suite creates (`tools/migration/tests/migration-export.int.test.ts` 6/6 on the revision), and the Supabase migration was applied to the local stack, producing the documented bootstrap row `state = open, updated_by = bootstrap`.

**The publication sequence (delivered with the fence):**

- `tools/migration/src/publish.ts` implements the C06A transitions: `recordVerifiedState` (writes `verified` from a `data-committed` run, idempotent on a repeat, refuses an already-published or unknown run), `recordPublicationIntent` (requires the recorded verification) and `admitWriters` (requires `publication-intent`, then sets the receipt to `writable` **and** opens the gate in the same transaction, so a destination can never be writable without the intent recorded first). `migration verify --record` is the opt-in that persists verification (read-only verify stays the default).
- Both transitions take the same gate row lock `apply` takes, so an apply, a verification record, an intent and an admission cannot interleave. `apply` itself takes that lock first and refuses an open gate, and a missing gate table is probed under a savepoint so the documented fallback cannot poison the transaction with `25P02`.
- `migration publish --phase intent|admit --run-id … --reason … --actor …` is the operator interface, and it verifies that the run belongs to the connected destination before transitioning.
- `migration gate --state open` now obeys the recorded state: it refuses with `E_PUBLICATION_REQUIRED` unless a run for that destination has recorded publication intent (or completed publication). The pre-publication recovery path — restore the verified baseline, abandon the run, admit writers — is available only through an explicit `--recovery` transition, which is recorded with a `[recovery]` marker in the reason so the audit trail shows writers were admitted without a publication intent.

**Still open in C06B:**

1. **The V6 write-attempt matrix.** Delivered for the REST and Server Action surfaces by `tools/migration/tests/migration-fence-v6.int.test.ts` (live, 2/2): while fenced, `requireActive` refuses a POST with 503 `WRITERS_FENCED` + retry-after and `requireActiveActor` returns the read-only error, while a GET is admitted; after the recorded sequence (`verified` → intent → admit) the same surfaces are admitted again; and a run stopped at publication intent stays fenced with the retry completing from the durable state. Still to add: the mobile API surface and crash injection immediately after enablement and after a lost-response write. The suite leaves its disposable database in place because a migration session's own connection outlives the test and would surface as an unhandled error if the database were dropped underneath it.
2. **Never-committed queue provenance.** Imported outcomes replay safely, but automatic forward translation remains blocked when source ids were remapped.

**Environment note (found while verifying this checkpoint).** Thirty-five mobile guard tests were failing locally with `503 MOBILE_API_DISABLED`. The cause was not code: the gitignored `.env.local` carries the deployment rollout gates (`MOBILE_BEARER_AUTH_ENABLED=false`, `DURABLE_IDEMPOTENCY_ENABLED=false`), `loadEnvConfig` loads that file in test mode, and `tests/setup.ts` only *defaulted* the flag (`?? 'true'`), so a developer's local gate silently disabled the mobile suites while CI — which has no `.env.local` — stayed green. `tests/setup.ts` now pins the flag for tests; suites that exercise the disabled path stub it themselves.

**Live evidence (re-run on the restarted local stack).** With Docker and the Supabase containers up again, the live legs were executed on this revision and all passed: `tools/migration/tests/migration-roundtrip.int.test.ts` 6/6 running the full runbook (seed → fence both destinations via `migration gate --state fenced` → plan/apply/verify `--record` → `publish --phase intent` → `--phase admit`, with the publish exit codes asserted rather than swallowed), `tools/migration/tests/migration-export.int.test.ts` 7/7 including the live gate-durability transition, and the Supabase auth regression suites 17/17 (signup gate, RLS and recovery). Unit suite 1616 passed / 69 skipped, typecheck and lint clean.

**The destination lock and the apply protocol (delivered with the fence):**

- `apply` now takes `select … from public.migration_write_gate where id for update` as the **first statement of its app-data transaction** (`lockWriteGateForApply`). One row lock solves two problems: it serializes concurrent applies and operator gate transitions against the baseline check and the writes that follow it (the previously recorded C05 caveat about a plain `begin`), and it makes the C06A window a protocol rather than a convention — an apply against an **open** gate is refused with `E_WRITERS_NOT_FENCED` instead of running while application writers are still admitted.
- A deployment whose gate table does not exist yet proceeds: it has no fence to obey.
- The live round trip now runs the real sequence: fixture seeding by direct SQL, then `migration gate --state fenced` on both destinations, then plan/apply/verify, then `--state open` at the end (an abandoned run would deliberately stay fenced). `tools/migration/tests/migration-c05-recovery.test.ts` asserts the refusal and that the lock is the first statement in the transaction.

**Enforcement design decisions worth keeping (they were expensive to find):**

- The fence check must run **after** origin/CSRF and credential checks. Putting it first silently changed the ordering the mobile guard suites exist to protect.
- Hermetic guard tests mock the data layer, not the database, so the enforcement read has to resolve *without* a database in that environment. The gate read therefore classifies failures: a missing relation (`42P01`) and an unreachable database resolve to "no gate"; Next's "`cookies` was called outside a request scope" also resolves to "no gate" because it can only happen outside a served request; **any other** failure (permissions, schema) is surfaced and the guards refuse, so a broken gate is never mistaken for an open one.
- The refusal message lives in the app-side module rather than being imported from `tools/migration/src`, because application code must not import the migration tooling (the boundary-enforcement suite checks exactly that).

## Live verification round — 2026-09-20 (dispositions, retry history, verified-only publication)

Executed on `b3df48c` plus the uncommitted repair in this worktree, against Docker-hosted disposables only. Every suite ran with its fail-closed flag, so a missing prerequisite fails the run instead of skipping it.

| Suite | Fixture | Result |
|---|---|---|
| C03 exporter (`tools/migration/tests/migration-export.int.test.ts`) | `MIGRATION_TEST_REQUIRE=1`, disposable native `vsis_migration_c03_export`, Docker `postgres:16-alpine` | **7/7 passed** — the bundle carries the additive `retry-history.json` and validates |
| C02/V4 round trip (`tools/migration/tests/migration-roundtrip.int.test.ts`) | `MIGRATION_TEST_REQUIRE=1`, disposable `vsis_migration_c02_source`/`_target` + local Supabase stack | **6/6 passed** — apply persisted rows, mappings, dispositions and retry history; `verify` reconciled all four surfaces (a non-zero verify fails the suite); repeat no-op, later-bundle reverse leg and rollback proof passed |
| Native live integration (`idempotency`, `daily-hours-concurrency`, `admin-create-concurrency`, `advisor-security-remediation`) | `TEST_DATABASE_URL` on the migrated `vsis_test` | **21/21 passed, 0 skipped** |
| Supabase live regression (`registration`, `rls`, `confirmation-disabled`) | local stack, `SUPABASE_LIVE_REQUIRED=true` | **17/17 passed, 1 opt-in skip** (the confirmation-disabled case, correctly inert while `enable_confirmations = true`) |
| Offline migration suites (13 files) | — | **296/296 passed** |

Two defects in the live suite itself surfaced during this round and are fixed:

1. `resetDestinationFixtures` deleted `migration_runs` while `migration_record_dispositions` and `migration_retry_history` still referenced them (`23503`, `migration_record_dispositions_run_fk`). All six round-trip tests passed and the suite still failed in teardown. The cleanup now removes the two new tables before the run rows, and the suite ends green.
2. The publication sequence ran *after* that cleanup had deleted the receipt, so `publish --phase intent|admit` could not succeed and the shared destination was left fenced — the state this round started from. Publication now runs while the receipt still exists, is followed by the fixture cleanup, and the teardown asserts the gate ends `open` instead of assuming it.

Environment note for the next runner: the local Supabase stack was serving tokens signed with a stale Auth signing key (kid `b81269f1…`) while the committed `supabase/signing_keys.json` mints kid `cce1af9f…`, so every Admin API call failed `403 bad_jwt` and the round trip could not seed its destination. A `supabase stop`/`start` cycle (data volume preserved) aligned the container with the committed key; `supabase status` values are only trustworthy after that alignment.

**Still not live-device-covered:** a device replaying a key whose actor was remapped and a key older than the retention horizon. The publication crash points are covered by the live V6 suite, and the adopted C06A never-committed classification is covered by the portable-classification and retry-path suites. The final C02/C04/C05 recovery harness is now live-covered on the loopback Docker/Supabase stack in the section below; it remains a service-level harness rather than a live-device test.

## Live recovery suite (C02/C04/C05) — current revision green

`tools/migration/tests/migration-recovery.int.test.ts` runs against the disposable Supabase services (local stack or the hosted development project with `MIGRATION_TEST_ALLOW_REMOTE_SUPABASE=1`). Harness as designed: an in-process plan (`readDeploymentSnapshot` + `buildPreview` + `resolvePlan`, reference rows reviewed generically, `snapshot.sourceIdentities` populated so provisioning is reviewable), test-only decorators around the real ports, atomic row-locked gate snapshot/fencing in `beforeAll`, ownership-checked restoration in `afterAll`, and per-case cleanup that deletes the receipt's dependents first. When this file shares a Supabase destination with the round-trip suite, run the files with `--no-file-parallelism` as CI does; concurrent files intentionally see one another's gate or destination changes as drift.

**Root cause of the earlier `Supabase Auth user creation failed: {}`:** the destination's own **domain whitelist trigger** — Auth answers `500 {"code":"P0001","message":"Registration is not allowed for @recovery.test domain…"}` for a fixture domain it does not allow, in *both* the local stack and the hosted project. Two fixes followed:

1. **Production, kept:** `createSupabaseAuthAdmin` now reports Auth failures through `describeAuthError`, which falls back to `status`/`code` when Supabase leaves `message` empty (it was `{}`, which is why the cause took three probes to find). The same describer is used for listing and deletion.
2. **Suite, kept and hardened:** `beforeAll` records and fences the gate atomically under a row lock and inserts the fixture domain only when absent. `afterAll` restores the exact prior gate values only while the gate still carries the suite's unique ownership marker; a concurrent operator transition is preserved and reported instead of overwritten. It removes the whitelist row only when this suite inserted it, verifies every Auth/SQL fixture is absent, and reports cleanup failures after state handling instead of hiding them.

The suite uses unique run IDs, account IDs, emails and display names. This removed the earlier nondeterminism: a retained profile with the shared name `Recovery Case` had made the planner select `map` instead of provisioning a fresh identity.

The executable cases cover:

- *Dropped Auth creation response:* the matching run marker is rediscovered, exactly one account/journal row exists, and retry is a no-op.
- *Lost app-data commit response:* the decorator loses only the receipt-bearing transaction response; recovery verifies the durable profile, receipt, mapping, journal and account, then retry is a no-op.
- *Temporarily unreadable receipt after a lost commit response:* apply returns only `E_COMMIT_UNCERTAIN` without cleanup; direct SQL/Auth checks prove the committed facts remain, and a fresh-session retry verifies the receipt and returns a no-op.
- *Failed identity-journal write:* the journal transaction fails before commit and the marker-owned account is removed; no app-data receipt/profile/journal remains.
- *Source identity without a profile:* apply stops with `E_IDENTITY_WITHOUT_PROFILE` before destination mutation.
- *Source Auth/profile email mismatch:* apply stops with `E_IDENTITY_EMAIL_MISMATCH` before destination mutation.
- *Unrelated post-provisioning drift:* apply reports `E_DESTINATION_DRIFT`, removes the migration-created account and preserves the unrelated account/profile exactly.

**Live result (2026-09-21):** 7/7 passed against the loopback Docker/Supabase development stack with `MIGRATION_TEST_REQUIRE=1`. Teardown verified the gate returned to its prior `open` state and left zero `recovery.test` whitelist rows, recovery receipts, identity-journal rows or Auth accounts. The same current worktree passed round trip 6/6, fence V6 3/3, export 7/7 and Supabase RLS/registration 17/17. No hosted, Preview or Production environment was accessed.

**C07 V7 build evidence (2026-09-21, commit `8be8a90`):** the native and Supabase `npm run build` commands both passed with separate backend environment settings and no environment-file edits. The native prebuild Auth gate correctly skipped for that backend; the Supabase prebuild gate queried the loopback Docker Auth service and verified email ownership confirmation without the compile-only bypass. These are build/configuration checks, not proof of a fresh-schema install, supported-schema upgrade, migrated-fixture browser flow or real mobile client/session replay; those C07 gates remain open.


### C07 client/retry matrix — live and green (supersedes the handed-over attempt)

The earlier `tests/migration-retry-replay.int.test.ts` was removed rather than shipped red. Its root cause is now understood and fixed: the lookup reads through `getAdminClient()`, whose target comes from the *application's* Supabase env, while that suite seeded through the migration-suite env — two different databases, so the lookup legitimately found no rows.

`tests/migration-retry-live.int.test.ts` replaces it and seeds through `getAdminClient()` itself, so the target matches by construction. Live: **2/2 passed**.

- a stored committed outcome with a matching request fingerprint **replays** (status 200, handler executions 0, body `{"data":{"success":true},"error":null}`);
- a key with no portable history **executes as new work** (executions 1), the accepted policy boundary — the client parks at 90 days, effects are retained 97.

The suite is gated on `MIGRATION_TEST_REQUIRE=1` plus a configured admin client, removes every row it seeds (history rows, then the receipt they reference), and is wired into the Supabase CI job beside the round-trip and recovery suites.

**C07 gate evidence collected across this commit series:**

| Gate item | Evidence |
| --- | --- |
| Fresh install | `supabase db reset` + migration-history verification (recorded above) |
| Supported upgrade | `tools/migration/tests/migration-upgrade-path.int.test.ts` 1/1 live (`f87a4bc`), CI-wired |
| V1–V6 fence matrix | `tools/migration/tests/migration-fence-v6.int.test.ts` 3/3 live |
| Recovery | `tools/migration/tests/migration-recovery.int.test.ts` **7/7 live** — the full matrix, including both cases that were previously blocked |
| Client/retry matrix | `tests/migration-retry-live.int.test.ts` 2/2 live, CI-wired |
| Export / round trip | `migration-export.int.test.ts` 7/7, `migration-roundtrip.int.test.ts` 6/6 live |
| Both production builds | `NEXT_PUBLIC_BACKEND=supabase` and `=native` both compile (`npm run build`, exit 0) |
| Unit suites | 1639 passed / 82 skipped; typecheck and lint clean |
| Combined live record | recovery + retry + fence in one run: **3 files, 12 tests, all passed** |

The previously blocked cases are green and were closed in `8be8a90`; the suite's teardown restores the gate state and removes the whitelist rows, receipts, journals and accounts it owns, so no case in this matrix remains open.

### 2026-10-03 native 1.0.3 deployment/binding proof

An isolated archive of production commit
0cf125a249c3e00feac55337b43e7d72fbc8e95b uses the locked Next.js 16.3.8
dependency set. The pristine archive reaches Next.js type validation but is
rejected because its forgot-password route exports the file-local
PASSWORD_RESET_REQUEST_MESSAGE. A test-only compatibility harness removes only
that export modifier; with NEXT_PUBLIC_BACKEND=native and the same
non-standalone config branch used by Vercel, the 1.0.3 build passes.

The running local instance reports appVersion=1.0.3, backend=native, health 200,
and binds to Docker database vsis_migration_destination_20261003 with 37
migrations. A disposable authenticated browser session proves a fenced mutation
returns 503 WRITERS_FENCED, reads remain 200, missing cron configuration fails
closed with 503 NOT_CONFIGURED, and reopening the gate returns the same malformed
mutation to ordinary 400 VALIDATION_ERROR. Test identity/session artifacts were
removed and the gate ends open.

This closes the local native application/database-binding uncertainty and adds a
live browser-session fence leg. It does not claim a byte-for-byte pristine 1.0.3
native artifact or close provider-wide/real-device writer controls. Evidence:
docs/plans/evidence/c07-native-app-binding-2026-10-03.json.

## Remaining work / next eligible checkpoint

Current state (superseding the historical C06A snapshot above):

1. **C01, C01M, C02, C03, C04, C05 and C06A are PASS. C06B is BLOCKED/PARTIAL because provider-wide live lifecycle proof is outstanding; C07 is IN PROGRESS/BLOCKED on the same deployment controls plus real-device/session/remapped-actor/horizon proof; C00 remains BLOCKED on the remaining deployment/operational inputs; C08 has NOT STARTED.** No recovery-suite case remains open: the live recovery matrix is 7/7 and the application-targeted client/retry matrix is 2/2.
2. **Next work:** complete the C00/C06B deployment writer controls and denial/drain evidence, complete the C07 real-device/session matrix, and declare the remaining C08 resource ceilings. Then execute C08's representative-volume benchmark and both recovery rehearsals using [`C08_REHEARSAL_RUNBOOK.md`](C08_REHEARSAL_RUNBOOK_2026_10_04.md). No production apply should run before those gates are green.
3. **C06B's delivered scope** is the destination-wide fence and lock, publication/write-gate transitions, portable retry translation and the implemented uncertain-enablement recovery paths. The real-device/live-token limitations remain explicitly recorded in the C06A/C06B rows.
4. **C07's remaining client/session item is the real-device matrix** (live-device authentication/session invalidation, remapped-actor queued replay, and keys older than the retention horizon). Provider-wide writer lifecycle proof is shared with C06B; C08 has NOT STARTED. C09/C10 require explicit production authorization and are not requested.
5. C00 no longer lacks direction, row/growth/freeze/RPO/RTO inputs, external-object scope, source binding, or a Supabase recovery target. Remaining operator/deployment inputs are the exact production ingress/cron deny and rollback control, Supabase Auth/admin freeze mechanism, privileged writer ownership, external integration/old-deployment coverage, drain observation interval, pending-client/device inventory, SMTP/enrollment readiness, durable/off-host recovery/retention evidence, and the C08 ceilings for total window, peak RSS, peak disk and maximum allowed row size.
6. Disposable resources used by the live gates: `vsis_migration_c02_source` / `vsis_migration_c02_target` (created and dropped by the round-trip suite), `vsis_migration_c03_export` (created and dropped by the export suite), the long-lived `vsis_migration_native_test` from C01, and the local Supabase stack. Each suite removes its own rows, receipts, mappings and accounts; the round-trip teardown also removes the dispositions and retry-history rows it created and asserts the destination gate ends `open`. The retry-live suite seeds and removes its own receipt and retry-history rows through the application's admin client, whichever database that is configured for.

**Outcome statement (updated 2026-09-21; superseded — see the 2026-10-03 reconciliation at the top of this file, under which C06B is BLOCKED/PARTIAL):** C01/C01M/C02/C03/C04/C05/C06A/C06B are PASS and C07 is IN PROGRESS with only the real client/session matrix outstanding — no recovery case is left open. C00 still needs operator inputs, C08 has a ready procedure but has not started, and C09/C10 are not requested. No production system has been contacted, no bulk email was sent, no credential was transferred, and no source dataset has been retired.
