# Supabase/native migration — current notes

**C08 rehearsal resumed at the user's request on 2026-10-04.** Disposable
rehearsal operations and read-only source access are authorized. Production
cutover remains separately gated. The accepted 60-minute rehearsal window
reserves 15 minutes for abort/recovery, leaving 45 minutes for the normal
sequence including review. The fresh native 1.1.6 rehearsal passed in
33m 36.376s; with the reserve, 48m 36.376s fits the accepted window.

Updated 2026-10-04. Execution follows the
[four-stage plan](SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md): Prepare /
Dry run / Cutover / Observe. Fresh disposable qualification and rehearsal
evidence is recorded; final OpenShift validation is being prepared. Neither
authorizes production cutover.
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
  deployed proof. User selected native 1.1.6 for migration qualification.
  [Explicit release transition checks](decisions/C08_RESUME_PACKET.md) are
  required before fresh planning/apply. Earlier native 1.0.3 smoke used a
  compatibility harness; final host and external enrollment remain open.
- Historical implementation/test successes retain their original scope.
  The fresh disposable actual-data rehearsal passed; production writer
  stop/deny/drain and final OpenShift validation are not complete.

## Resumed qualification — 2026-10-04

### Destination and freeze decisions

- Operator selected local mail capture for final-host rehearsal only. Real
  external enrollment delivery remains a separate production readiness gate.
- Operator selected OpenShift Local on this machine, project `vsis-timesheet`
  and HTTPS hostname `timesheet.apps-crc.testing` (operator-confirmed).
- Operator confirmed keeping Docker PostgreSQL primary
  `vsis_migration_destination_20261003`. Container `vsis-migration-native` is
  running PostgreSQL 16 with host port 5432 bound only to loopback; secure
  OpenShift pod-to-host connectivity and final connection binding remain unverified.
- Operator confirmed everything may be stopped and proposed stopping Vercel.
  This records availability of a freeze, not a completed shutdown or cutover
  authorization. Direct Supabase/browser, privileged and external writers still
  require inventory, idle/denial and drain evidence alongside Vercel controls.
- Read-only inspection through `crc-admin` reached the local cluster. The saved
  developer context lacks access to the requested project; the project does not
  exist. OpenShift Local reports version 4.22.1. The node is Ready but has
  DiskPressure, and machine-config is degraded (`RequiredPoolsFailed`). CRC
  reports 30.95 GB of 32.68 GB used. No project, route, workload, credential or
  production writer control was changed. Later read-only checks report Running,
  node DiskPressure False, machine-config Available True / Degraded False and
  16 GiB available on the writable filesystem. No storage resize or cleanup was
  performed here; recheck health before deploying.
- CRC host-network-access defaults to false and the controller-pod TCP probe to
  `host.crc.testing:5432` timed out. Docker PostgreSQL currently accepts TCP
  trust authentication with a passwordless superuser and TLS off. Authentication
  and transport preparation must precede enabling CRC access; see the
  [bounded decision packet](decisions/C08_OPENSHIFT_DATABASE_ACCESS_PACKET.md).

### Qualification results

- Restored-backup OpenShift host checks passed at `timesheet.apps-crc.testing`:
  verified TLS, native 1.1.6, allocated UID, captured reset/single-use/fresh login,
  CRUD/report/replay/failure checks and router spoof handling. Workloads are
  scaled to zero, messages/test effects removed, and all 24 primary and original
  table digests are unchanged. Root also confirmed no port-forward process.
  Independent closure found no material issue within this scope. This does not
  prove fresh migration admission, first-time passwordless enrollment, external
  delivery or new-platform freeze/recovery timing. See
  [host evidence](../evidence/c08-openshift-host-functional-2026-10-04.json).
- Final restoration returns CRC host access to its original disabled default,
  with verified pod TCP denial before resuming Supabase test services. Primary
  TLS/SCRAM is retained and rehearsal workloads remain zero replicas. Supabase
  core services/database respond; Vector still restarts with connection refusal.
  The paused performance fixture was absent at restoration, so was not recreated.
  Source health remains OK; no production control was applied. Production SMTP
  and direct/privileged/external freeze ownership are requested inputs. Fresh
  source/primary planning and new-platform timing remain outstanding.
- Resumed OpenShift access preparation passed disposable TLS/SCRAM and runtime
  migration qualification: seven stages, eleven matrix checks and supplemental
  role/membership/diagnostic assertions. The dedicated selected primary is now
  hardened, with all 24 public-table digests unchanged and no primary migration
  or import. Operator-approved local Supabase/performance test containers are
  paused with their data preserved. CRC host access is enabled and restart is
  in progress; actual pod/Route/image validation remains pending. See
  [access evidence](../evidence/c08-openshift-access-2026-10-04.json).
- CRC restart recovered after a daemon-launcher correction and transient
  Hyper-V memory failure. Actual pod-to-host TCP and verified TLS tests pass.
  The requested namespace now exists with candidate build/diagnostic resources.
  Numeric USER 1001 fixes the image's Kubernetes runAsNonRoot validation failure;
  the immutable candidate digest and pending cloned final-host rehearsal are
  recorded in [destination preparation](OPENSHIFT_LOCAL_CUTOVER_PREPARATION.md).
- Fresh read-only inspection at 13:53 UTC confirms production ledger entry
  `20261006000000`, unchanged portable schema fingerprint, 23 profiles and
  854 timesheets. Production index catalog/EXPLAIN verification remains open.
- The operator now permits Supabase application 1.0.3 to native application
  1.1.6 explicitly at preflight, plan and apply. Historical 1.0.3 defaults and
  transitions remain supported; export source/tool declarations stay truthful.
  Schema, ledger, target identity, fence and receipt guards remain enforced.
- Qualification patch: 193 focused tests and 445 full tests passed; 41 optional
  integration tests skipped. Lint, typecheck, coverage gates and independent
  delta review passed. Fresh native 1.1.6 production build passed without
  compatibility edits. Fresh actual-data rehearsal passed; see
  [1.1.6 qualification evidence](../evidence/c08-native-116-qualification-2026-10-04.json).
- Fresh export matches all 12 prior canonical entities. All 53 reviewed overlap
  choices remain equivalent; four destination-only projects are retained. Root
  verified and pinned the fresh plan/resolution and exact loopback target.
  Apply created 958 rows and mapped 53; complete verification was recorded,
  and replay was a no-op with zero row drift.
- Merged backup restore and seeded-baseline abort restore matched all 24 public
  table digests on separate disposable clones. Abort recovery took 1.818s.
  Disposable intent/admit passed. Native 1.1.6 loopback enrollment/reset, token
  reuse refusal, fresh login, cookie create/replay/edit/report, invalid-hours
  refusal and smoke-row cleanup passed. Final counts: 23 profiles, 854
  timesheets and 47 projects. Original baseline and previous successful clone
  remain unchanged; owned app/SMTP processes are stopped.
- The unchanged clock ran 14:20:40.857–14:54:17.233 UTC, including review,
  recovered launcher failures and final closure checks: 33m 36.376s normal,
  plus 15 minutes reserve = 48m 36.376s. Simulated stop/drain does not prove
  production freeze controls. Loopback mail is not external delivery proof.
  Local deployment required direct-loopback IP acknowledgement and a rate-limit
  subject secret. Neither import nor publication was repeated during recovery.
- A representative queued keyed edit was refused with
  `409 IDEMPOTENCY_REVIEW_REQUIRED` without mutation; queued replay remains
  uncertified. Verification preceded smoke; local credential/audit/retry effects
  remain on the disposable clone, so no post-smoke reconciliation is claimed.
- The build includes the current uncommitted application work. A final immutable
  deployment artifact/commit, final host and external enrollment remain open.

## Earlier C08 evidence — 2026-10-04 (1.0.3 target)

- Fresh read-only source inspection passed against the configured production
  Supabase source. PostgreSQL reports 17.6, no required tables are missing, the
  source schema fingerprint is
  `486a9ab877a2c48e5de8b15e9f26a981f58ddc188c25b9c129c31f721763e94b`,
  and the migration ledger reaches `20261005000000`. The current counts are
  recorded without row contents in
  [C08 readiness evidence](../evidence/c08-readiness-2026-10-04.json).
- Production remains verified as release 1.0.3 at
  `0cf125a249c3e00feac55337b43e7d72fbc8e95b`; at that rehearsal the migration
  CLI admitted only 1.0.3. The dirty working checkout was not release proof.
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
  [rehearsal results](../evidence/c08-actual-data-rehearsal-2026-10-04.md).
  Complete production window timing and pristine final release remain open;
  production publication/cutover has not run.

# Pending work

- [x] Qualify pinned native 1.1.6 on the final OpenShift host, effective database
  role/TLS, proxy/client-IP configuration and external reset delivery. Local
  timing and external reset passed on 2026-10-05; see
  [current preparation](OPENSHIFT_LOCAL_CUTOVER_PREPARATION.md).
- [x] Confirm writer ownership: the operator reports Vercel is the sole source
  writer. Recheck inventory if the deployment changes before cutover.
- [ ] Recheck final release/commit/image bindings, and prove actual production
  stop/deny/fence/drain during the later authorized window. Provider pause was
  not executed by the rehearsal; no billing/plan change is authorized.
- [ ] Settle or isolate pending mobile dev/test queues, record disposition and
  require fresh destination login. Mobile is not in production; no remapped
  replay assumption or production device matrix is needed for this cutover.
- [x] Run one protected actual-source-data rehearsal on disposable seeded native;
  resolve seed overlaps/ID mappings/hierarchy decisions, verify transactional
  import/receipts/retries and reconciliation, prove backup restore and
  login/create/edit/report smoke, and demonstrate actual fit in the 60-minute
  freeze including final review and abort allowance. RPO 120 / RTO 720 minutes
  remain prior operating goals, not new measured PASS results.
  Fresh native 1.1.6 import/restore/application smoke and the simulated window
  passed on 2026-10-04. Production stop/deny/drain remains separately unproven.
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
