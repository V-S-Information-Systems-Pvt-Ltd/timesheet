# Supabase/native migration — current notes

Updated 2026-10-04. Execution follows the
[four-stage plan](SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md): Prepare /
Dry run / Cutover / Observe. This is documentation implementation only; no live
operation, production authorization or newly passing operational gate is claimed.
The complete previous ledger is a
[dated historical reference](archive/SUPABASE_NATIVE_MIGRATION_NOTES_2026_10_04.md).

## Established context

- First direction: Supabase `bcsdqkjzobllocejfcdz` → native Docker
  `vsis_migration_destination_20261003`. The operator confirmed production
  source binding on 2026-10-04; changes require reconfirmation.
- `MIGRATION_DESTINATION_DB` is hosted `timesheet-test` recovery, not native.
  Its scoped source-archive restore/reconciliation is recorded in
  [restore evidence](archive/C00_SUPABASE_SOURCE_RESTORE.md); login/platform proof is
  distinct. Securely load named `MIGRATION_*` variables without printing values;
  the CLI npm script does not auto-load `.env.local`.
- The target is seeded: 45 projects, 5 activities, 6 titles and settings.
  [Name/ID overlaps and hierarchy findings](archive/C00_LIVE_INVENTORY_2026_10_03.md)
  need explicit resolutions, mappings and complete merged-state reconciliation.
  Incoming passwords/sessions are excluded; destination enrollment/reset is required.
- Production is 1.0.3 without cron gate hardening; branch hardening is not
  deployed proof. Current CLI admits 1.0.3 only. Earlier local native build
  proof used a compatibility harness removing a forgot-password route constant
  export; pristine release validation, final host and enrollment remain open.
- Historical implementation/test successes retain their original scope.
  Writer stop/deny/drain and the actual-data rehearsal are not complete.

## Continuation evidence — 2026-10-04

- Fresh read-only source inspection passed against the configured production
  Supabase source. PostgreSQL reports 17.6, no required tables are missing, the
  source schema fingerprint is
  `486a9ab877a2c48e5de8b15e9f26a981f58ddc188c25b9c129c31f721763e94b`,
  and the migration ledger reaches `20261005000000`. The current counts are
  recorded without row contents in
  [C08 readiness evidence](evidence/c08-readiness-2026-10-04.json).
- Production remains verified as release 1.0.3 at
  `0cf125a249c3e00feac55337b43e7d72fbc8e95b`; the migration CLI still admits
  only 1.0.3. The dirty working checkout reports 1.1.6 and is not release proof.
- After operator confirmation, Docker Desktop was located under the user
  profile at `AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe`.
  Read-only Docker inspection found `vsis-migration-native` running and
  publishing `127.0.0.1:5432`. This supersedes the earlier runtime availability
  blocker. The seeded baseline was inspected and restored into disposable
  `vsis_c08_rehearsal_20261004_105004`; all 24 public table row digests matched,
  and the original seeded database remained unchanged.
- The operator explicitly authorized copying actual production records into
  a locally protected temporary rehearsal bundle and validating it. Export and
  validation both passed for run `dryrun-20261004-105004`, release 1.0.3.
  The 16-file, 372,434-byte bundle and its digest/path are recorded in the
  readiness evidence above. Directory inheritance was disabled before export;
  current-account, SYSTEM and Administrators access was verified on every file.
  This operation uses ACL protection, not artifact encryption. Temporary local
  retention is not durable/off-host recovery proof. Source access remains
  read-only. The disposable native clone passed eight preflight checks and was
  fenced; 53 overlaps were resolved while retaining four destination-only
  projects and preserving source role/classification decisions.
- Actual-data apply exposed two operator defects: reference Telegram slot reuse
  and compound metadata key encoding. Both failures rolled back fully against
  23 checked tables, leaving no profiles, timesheets or import receipts. Repairs
  passed focused unit/live PostgreSQL verification. Actual-data import,
  reconciliation/no-op, fenced denial, backup/abort restore and local enrollment/
  login/create/edit/report smoke now pass. See the
  [rehearsal results](evidence/c08-actual-data-rehearsal-2026-10-04.md).
  Complete production window timing and pristine final release remain open;
  production publication/cutover has not run.

# Pending work

- [ ] Finalize exact supported release/commit and native host; fix/validate the
  pristine native artifact and verify destination enrollment/reset and login.
- [ ] Complete known writer ownership, rehearsed stop/deny controls and drain
  interval/proof, including old URLs, scheduled/manual cron, Auth/admin,
  service-role, SQL/admin and external writers. Provider pause remains unproven;
  no billing/plan change is authorized or assumed.
- [ ] Settle or isolate pending mobile dev/test queues, record disposition and
  require fresh destination login. Mobile is not in production; no remapped
  replay assumption or production device matrix is needed for this cutover.
- [ ] Run one protected actual-source-data rehearsal on disposable seeded native;
  resolve seed overlaps/ID mappings/hierarchy decisions, verify transactional
  import/receipts/retries and reconciliation, prove backup restore and
  login/create/edit/report smoke, and demonstrate actual fit in the 60-minute
  freeze including final review and abort allowance. RPO 120 / RTO 720 minutes
  remain prior operating goals, not new measured PASS results.
  Technical import/restore/application smoke passed on 2026-10-04; the complete
  accepted freeze-window demonstration remains open.
- [ ] Present concrete window/control/release/source/target/recovery evidence for
  final user approval; then perform the authorized final freeze/export/import,
  `verify --record`, intent and admit sequence. Final native business smoke writes
  begin only after admission; pre-intent smoke is disposable-rehearsal-only.
- [ ] Observe sole native write authority, errors, credentials, report totals and
  backup usability; retain fenced recoverable source until separate retirement approval.

Before intent, keep native isolated; restore the seeded baseline or abandon the
disposable target. For source resumption, release the exact generation-bound
provider artifact with `--recovery` before matching gate recovery. After intent,
inspect receipts and refuse bypasses. After native writes, preserve/reconcile
changes before source return. See the [recovery procedure](C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md#recovery).

## Deferred scope

**Not required for this cutover; not PASS:** staging/FDW, synthetic volume and
RSS/disk/max-row certification, full reverse/provider/platform recovery matrix,
long-horizon/real-device mobile matrix and off-host retention certification.
Protected usable backup/restore and the actual-data rehearsal remain required.

Current [rehearsal](C08_REHEARSAL_RUNBOOK.md) and
[freeze/drain](C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md) replace old checkpoint gates.
Historical [plan](archive/SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN_2026_10_04.md),
[rehearsal](archive/C08_REHEARSAL_RUNBOOK_2026_10_04.md) and
[freeze/drain](archive/C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK_2026_10_04.md) retain evidence.
