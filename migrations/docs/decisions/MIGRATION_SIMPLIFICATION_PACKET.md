# Migration simplification decision — 2026-10-04

## Decision required

Replace the active C00–C10 migration process with Prepare / Dry run / Cutover /
Observe for the first Supabase-to-native transfer. The user requested a simpler
process and then explicitly requested implementation of the reviewed findings.
This change is documentation only; production execution is a separate action.

## Evidence and constraints

- FACT: `migrations/tool/src/cli.ts` refuses normal gate reopening outside
  publication. `publish.ts` requires verification, intent, then admission.
- FACT: `migrations/tool/src/gate.ts:recoverWriteGate` refuses recovery reopening
  after publication intent. Provider-fence recovery checks the exact artifact
  generation; release provider grants before reopening the corresponding gate.
- FACT: `C00_LIVE_INVENTORY_2026_10_03.md` records 45 seeded native projects,
  5 activities, 6 titles and settings, with name overlaps and differing IDs.
  Preserve implemented merge planning, resolutions, mappings and reconciliation.
- FACT: portable credentials are excluded. Destination enrollment/reset and
  login need a working deployment and a real smoke check.
- FACT: production 1.0.3 lacks the branch's cron gate hardening. Known HTTP,
  cron, Auth/admin, service-role, SQL and external writers need stop/deny and
  in-flight drain before the final snapshot; a maintenance page is insufficient.
- FACT: source is `bcsdqkjzobllocejfcdz`; native primary is Docker database
  `vsis_migration_destination_20261003`. `MIGRATION_DESTINATION_DB` is the hosted
  `timesheet-test` recovery connection, not the native primary connection.
- FACT: mobile is not in production; pending test/development queues must be
  explicitly settled or isolated, not automatically replayed after migration.
- FACT: `profiles.full_name` is intentionally excluded and separately scheduled
  for retirement. Do not transfer source credentials or reveal environment values.
- UNKNOWN: actual-data end-to-end dry-run fit within the accepted 60-minute
  freeze, finalized release/native host and enrollment readiness, and usable
  production writer controls remain unproven. Do not mark these complete.

## Alternatives and chosen boundary

Keep the old checkpoint process: unnecessary certification and repeated gates
for this cutover. Remove implemented safety machinery: rejected because seeded
data, credentials and publication recovery still need it. Chosen: shorten the
operator process, retain working tool contracts, preserve detailed history as
linked reference, and explicitly mark deferred requirements “not required for
this cutover,” never PASS.

## Lifecycle and recovery

Prepare the release, native host, credential path, backup and known writer list.
One protected actual-data dry run resolves overlaps, transactionally imports,
reconciles, verifies backup restore and exercises login/create/edit/report.
Final cutover requires concrete production approval, then stop/drain, final
export/review/apply/verify and current publication commands. Keep Supabase frozen
and recoverable during observation. Before intent, abandon native and resume
source only via the matching fence recovery procedures, leaving native isolated.
After intent, stop and inspect receipt state; never bypass guards. After native
writes, preserve/reconcile those changes before returning to source; no blanket
loss approval, mandatory reverse migration, or effortless rollback claim.

Retain retry/receipt safeguards for retries, stale plans, crashes and concurrent
transitions. These are implemented contracts, not scope for runtime refactoring.

## Acceptance and bounded review

- Active plan has four stages and an honest, short pending checklist.
- One real-data rehearsal replaces synthetic/long-horizon certification;
  staging/FDW, full recovery matrix and off-host retention certification are
  follow-ups, without claiming PASS or removing the usable backup requirement.
- Docs reference current executable commands and existing environment roles.
- Detailed previous docs and evidence remain linked; no secrets or live changes.
- Check relative paths/anchors and whitespace, inspect delta against starting
  dirty worktree. No application test rerun for documentation-only changes.
- Independent reviewer checks only publication/rollback, writer coverage,
  credentials, seeded merge, honest scope/status and command accuracy.

## Finding ledger

S1 retain seeded-reference matching/remapping; S2 qualify source rollback after
native writes/intent; S3 retain verified-only publication; S4 stop/drain known
writers; S5 verify destination credential path. S6 defer extra certification
without relabeling it PASS. All are implementation acceptance checks, not new
runtime changes.

## Implementation and closure

The active plan, notes, rehearsal and freeze/recovery instructions now use the
four-stage process (420 lines, previously 1,945). Complete previous bodies are
retained in four dated archive snapshots with rebased links. The documentation
index, architecture assessment precedence notice and architecture delta agree.

S1–S6 are resolved in the documentation. Independent Astra review found no
actionable issue and checked the targeted publication/recovery source guards.
The worker verified 146 relative links, 10 anchors, 19 command examples, archive
body preservation and unchanged hashes for 89 unrelated dirty files. Root
checked 38 active links/anchors, whitespace and executable CLI help (exit 0).
No application tests were rerun for this documentation-only change. No database,
provider or production action ran; operational checklist items remain pending.
