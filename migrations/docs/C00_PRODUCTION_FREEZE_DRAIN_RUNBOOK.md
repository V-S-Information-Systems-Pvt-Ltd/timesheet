# Migration freeze/drain and recovery — preparation only

Updated 2026-10-04 for the [four-stage plan](SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md).
This prepares a concrete cutover; it does not authorize production. The
[previous body](archive/C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK_2026_10_04.md)
retains historical provider discovery and checkpoint requirements.

## Prerequisites

Record release/commit, native host, source/target identities, run id, operator,
protected unused fence-artifact path, writer/recovery owners and
`drain_observation_seconds`. Final approval covers the concrete window, controls,
release, source and target after reviewable actual-data rehearsal evidence.

Production `ts.kst.st` → Supabase `bcsdqkjzobllocejfcdz` was operator-confirmed
on 2026-10-04; reconfirm changed bindings. Native primary is Docker
`vsis_migration_destination_20261003`; `MIGRATION_DESTINATION_DB` is hosted
`timesheet-test` recovery, not native. Retain reviewed seed-overlap/ID/hierarchy
resolutions and known seeded baseline backup.

CLI now explicitly supports Supabase application 1.0.3 to native application
1.1.6, preserving historical 1.0.3 defaults and transitions. Fresh native 1.1.6
actual-data rehearsal, restore and credential smoke passed; the measured interval
plus the 15-minute recovery reserve fits 60 minutes. The selected production
destination is OpenShift Local on this machine, project `vsis-timesheet`, HTTPS
hostname `timesheet.apps-crc.testing`, retaining the existing Docker PostgreSQL
primary. Final immutable image, secure pod-to-host connectivity, database binding,
external enrollment and production stop/drain evidence remain open. Production
1.0.3 lacks cron gate hardening. Long-device/horizon/full recovery matrices are not required
for this cutover, not PASS. Mobile is not in production; settle/isolate dev/test
queues and require fresh native login.

Run from `migrations/tool/`. Securely load named `MIGRATION_*` variables without
logging values, or use an existing safe env-file launcher; npm does not auto-load
`.env.local`. Replace placeholders; `<MIGRATION_NATIVE_DB>` means an explicit
operator-configured native variable, never the hosted recovery connection.

## Stop, deny and drain

1. Read source gate; confirm identity, expected ledger, state, run/generation.
2. Fence application writers for the run; verify mutation refusal and record
   generation. Final native stays isolated and fenced before planning/applying.
3. Activate Supabase ordinary-role table-DML fence; retain its exact protected
   grant artifact. Verify while the API is still reachable.
4. Stop/deny HTTP and scheduled/manual cron, including old deployment URLs,
   login/signup/refresh, Server Actions and browser/mobile mutations.
5. Stop/deny provider Auth/admin, service-role, PostgreSQL/admin SQL and external
   jobs/integrations; table grants alone cannot stop these writers.
6. Drain in-flight work for the declared interval. Capture two bounded observations
   proving listed writers have no active write transaction or new durable mutation.
7. Record denial/idle proof for every known surface before final backup/export.
   Any uncontrolled writer or failed drain blocks the final snapshot.

```powershell
npm run migration -- gate --target supabase --target-env MIGRATION_SOURCE_DB --json
npm run migration -- gate --target supabase --target-env MIGRATION_SOURCE_DB --state fenced --run-id <run-id> --reason "final migration freeze" --actor <operator> --json
npm run migration -- fence --target supabase --target-env MIGRATION_SOURCE_DB --action activate --run-id <run-id> --reason "final migration freeze" --actor <operator> --out <protected-source-fence-artifact> --json
npm run migration -- fence --target supabase --target-env MIGRATION_SOURCE_DB --action verify --json
npm run migration -- gate --target native --target-env <MIGRATION_NATIVE_DB> --state fenced --run-id <run-id> --reason "native import window" --actor <operator> --json
```

Supabase fence defaults to `anon,authenticated`; it is not a service-role/Auth
freeze. Explicit role selections must match on recovery. A maintenance page is
insufficient. A hardened cron release must refuse authenticated GET/POST without
writing; production 1.0.3 needs proven platform deny for scheduled/manual cron.
Use the [writer inventory](archive/C00_WRITER_CONTROL_INVENTORY.md) to name credential
owners without secrets. Include privileged registration/profile, session/
idempotency, admin reset/import/restore and cleanup writers, direct SQL, external
scripts and still-routable old deployments with write credentials.

## Provider-control status

The operator confirmed on 2026-10-04 that everything may be stopped and proposed
stopping Vercel as the application shutdown control. No production stop has run.
Vercel documents production `503 DEPLOYMENT_PAUSED` after project pause, but this
does not establish denial of old deployments, direct Supabase browser requests,
provider Auth/admin, SQL or external processes. Existing work must drain; retain
the source write fence and the separate privileged/identity-writer controls.
References: [project pause](https://vercel.com/docs/projects/managing-projects#pausing-a-project)
and [cron lifecycle](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Project pause is a **candidate, unproven control**. Production/development aliases
share one Vercel project; rehearse on a separate disposable project, using the
production id only as an exclusion check. Prove old URLs, scheduled/manual cron
and current hostname are denied. Record control scope and exact resume action;
[deployment inventory](archive/C00_VERCEL_DEPLOYMENT_INVENTORY.md) preserves discovery.

Supabase Auth/admin pause eligibility and privileged-writer shutdown remain
unresolved. Signup-disable and DB network restrictions do not establish all Auth/
HTTPS writer denial. No project transfer, downgrade, payment or plan change is
authorized/promised. Retain tool gate and table fence alongside ingress controls.

## Publication

Final native admits after transactional import and reconciliation through the
[operator sequence](C08_REHEARSAL_RUNBOOK.md#operator-sequence):
**`verify --record` → `publish --phase intent` → `publish --phase admit`**.
Intent keeps writers fenced; admit atomically records writable receipt and opens
the matching gate. Ordinary `gate --state open` is refused. Source stays fenced
and recoverable. Destination ingress/enrollment and final business smoke writes
begin after admission. Pre-intent smoke is disposable-rehearsal-only, never
persisted in final native.

If a destination provider fence was separately activated, normal release uses
its exact artifact only after writable-receipt authorization. The native example
does not invent a destination provider-fence requirement.

## Recovery

**Before publication intent:** stop, keep native isolated and restore/verify known
seeded native baseline, or abandon disposable native. Preserve artifacts for
uncertain apply diagnosis. Source resumes only after confirming no destination
intent/writable receipt or retained native business writes. Release grants using
the **exact artifact** before matching source gate recovery; reopening first
changes the generation binding needed for release.

```powershell
npm run migration -- fence --target supabase --target-env MIGRATION_SOURCE_DB --action release --inventory <protected-source-fence-artifact> --recovery --reason "pre-intent abort; native isolated and baseline verified" --json
npm run migration -- gate --target supabase --target-env MIGRATION_SOURCE_DB --state open --run-id <run-id> --recovery --reason "pre-intent abort; source grants restored" --actor <operator> --json
```

Check both results before restoring source ingress/identity/external writers.
Provider recovery checks the same fenced run, generation and updatedAt against
the artifact; gate recovery checks current run and refuses intent/writable
receipts. This is not a general gate-open shortcut. Native stays isolated through
source resumption; do not restore the final native writer gate.

**After intent or uncertain admission:** stop, keep ingress closed and inspect
durable receipt/gate/fence state before guarded continuation/recovery. Refuse
straight gate-open, stale-artifact, receipt-delete or SQL bypass. Source's lack
of a local receipt cannot override destination publication state.

**After native business writes:** freeze native authority; preserve/reconcile its
changes before considering source return. Record recovery target, merge/
provenance and credential requirements. Full reverse migration is a contingency,
not mandatory pre-cutover certification. No blanket loss approval or effortless
rollback is implied. Retirement remains separately authorized with unchanged criteria.

## Evidence and open blockers

Keep release/database bindings, run/generation, artifact digest/path, control
scope, writer owners, denial/idle proof, drain interval/timestamps, final snapshot
ids, reconciliation and receipt transitions. Retain no tokens, connection strings
or environment values. The local 1.1.6 rehearsal and simulated window passed;
production controls/drain, immutable image/host/database and external enrollment
remain unproven. Complete
[Pending work](SUPABASE_NATIVE_MIGRATION_NOTES.md#pending-work) before final approval.
