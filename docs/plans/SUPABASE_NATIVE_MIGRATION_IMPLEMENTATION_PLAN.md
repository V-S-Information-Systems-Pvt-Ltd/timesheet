# Supabase to native migration — four-stage implementation plan

Updated 2026-10-04 from the [reviewed packet](../ai-context/MIGRATION_SIMPLIFICATION_PACKET.md).
This active plan replaces C00–C10 execution prerequisites for the first Supabase
→ native cutover. No production operation or approval is included. The complete
[old plan](archive/SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN_2026_10_04.md) and
[old notes](archive/SUPABASE_NATIVE_MIGRATION_NOTES_2026_10_04.md) preserve historical
decisions and evidence; previous PASS results retain their original scope.

## Prepare

- Confirm source, target, release/commit, native host and enrollment route.
  The operator confirmed production `ts.kst.st` → Supabase
  `bcsdqkjzobllocejfcdz` on 2026-10-04; reconfirm changed bindings.
  Native primary is Docker `vsis_migration_destination_20261003`.
  `MIGRATION_DESTINATION_DB` is hosted `timesheet-test` recovery, **not native**.
- Securely load named `MIGRATION_*` variables without logging values. The npm
  script does not auto-load `.env.local`. Protect connections, bundles, plans,
  backups and exact-generation grant artifacts; use an explicit native variable.
- Finalize a supported release and validate the pristine native artifact.
  CLI support is currently **1.0.3 only**. Production 1.0.3 lacks the branch's
  cron gate hardening. Earlier local native build proof used a compatibility
  harness removing the forgot-password route constant export; pristine release
  fix/validation, final host and enrollment remain open. No runtime edit is
  included in this documentation change.
- Retain usable protected source backup and known seeded native baseline;
  prove restore and recovery access. Existing [source backup](archive/C00_PROTECTED_SOURCE_BACKUP.md),
  [source restore](archive/C00_SUPABASE_SOURCE_RESTORE.md) and
  [native baseline](archive/C00_BACKUP_AND_UPGRADE_READINESS.md) evidence is scoped;
  credential/account usability remains distinct.
- Name and rehearse known writer stop/deny controls and drain proof using the
  [freeze/drain runbook](C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md). A maintenance
  page cannot freeze data. Provider pause is unproven; no billing/plan change
  or provider capability is promised.
- Mobile is not in production. Explicitly settle or isolate pending dev/test
  queues and record disposition; require fresh destination login. Do not assume
  remapped queued requests replay. Retain implemented retry-history, fresh-key
  and old-session rejection contracts.

## Dry run

Perform **one protected actual-source-data dry run** on disposable native using
the [rehearsal runbook](C08_REHEARSAL_RUNBOOK.md). Export a consistent read-only
source snapshot; seed the target like final native. Rehearse writer controls on
disposable infrastructure, never by pausing the shared production provider project.

Preserve merge contracts. Native starts with 45 projects, 5 activities, 6 titles
and settings. The [inventory](archive/C00_LIVE_INVENTORY_2026_10_03.md) records 41 project,
5 activity and 6 title name overlaps with different IDs, project/activity field
differences and three title/hierarchy discrepancies. Review classifications and
explicit match/field decisions; map identities/references before dependent rows.
Retain destination-only rows; validate both role axes, active state, ownership,
hierarchy cycles, constraints and totals. Names alone do not authorize merging.
`profiles.full_name` is excluded; its [retirement](PROFILE_FULL_NAME_RETIREMENT_PLAN.md)
is separate.

Keep digest-bound plans/resolutions, transactional import, mappings, receipts,
dispositions, reconciliation and retry safeguards. No partially committed batch
workaround or runtime simplification is approved. Source passwords/sessions do
not transfer; matched destination credentials remain, incoming users enroll/reset.

Prove backup restore and destination enrollment/login/create/edit/report smoke
with reconciled totals. Pre-intent smoke writes belong only to disposable
rehearsal clones, **never persisted in final native before verified-only admission**.
Measure operator elapsed time including stop/drain, final export, fresh review,
apply, verification, admission and agreed abort allowance. Prove actual-data fit
in the accepted **60-minute freeze**; a miss blocks the proposed window.
RPO 120 / RTO 720 minutes are prior operating goals, not measured PASS results.

## Cutover

User approval is the final step after reviewable rehearsal evidence: approve the
concrete window, controls, release/commit, source, native target and recovery owner.
These documentation edits do not authorize production execution.

1. Stop/deny and drain every known source writer; fence source and final native
   for the recorded run. Keep protected exact-generation provider artifacts.
   Final native stays isolated from business/identity writers.
2. Capture final protected source backup/export only after denial/idle and drain
   proof. Validate, create/review fresh final preview/resolutions/digest, apply
   transactionally and reconcile the complete merged state. Do not silently
   reuse rehearsal plans against changed data or identities.
3. Follow the [operator sequence](C08_REHEARSAL_RUNBOOK.md#operator-sequence):
   **`verify --record` → `publish --phase intent` → `publish --phase admit`**.
   Check each receipt transition. Ordinary `gate --state open` is refused.
   Only then admit destination ingress/enrollment and final login/create/edit/report
   smoke writes. Keep source fenced.
4. On errors, stop and follow [recovery](C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md#recovery).
   Before intent, isolate native and restore/verify the known seeded baseline
   or abandon the disposable destination. Release the exact source artifact
   with `--recovery` before matching source gate recovery. After intent, inspect
   durable receipts and refuse bypasses. After native writes, preserve/reconcile
   those changes before source return; full reverse migration is a contingency,
   not mandatory cutover certification.

## Observe

Confirm native is the sole writable authority; monitor errors, enrollment/login,
create/edit/report totals and backup usability. Keep Supabase fenced, protected
and recoverable during the agreed observation period. Name the handoff owner;
retain timings, digests, mappings, receipts, writer proof and recovery decisions
without secrets. Source retirement is separately authorized; existing retirement
criteria remain unchanged.

## Current checklist and deferred scope

See [Pending work](SUPABASE_NATIVE_MIGRATION_NOTES.md#pending-work).
**Not required for this cutover; not PASS:** staging/FDW; synthetic volume,
RSS/disk/max-row certification; full reverse/provider/platform recovery matrices;
long-horizon/real-device mobile matrices; off-host retention certification.
Usable protected backup/restore, actual-data fit, writer control/drain, credential
smoke and verified-only publication remain required.

Historical detail: [old rehearsal](archive/C08_REHEARSAL_RUNBOOK_2026_10_04.md)
and [old freeze/drain procedure](archive/C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK_2026_10_04.md).
