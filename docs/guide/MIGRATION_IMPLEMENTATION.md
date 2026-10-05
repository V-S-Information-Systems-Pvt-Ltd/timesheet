# Supabase → native implementation guide

## Qualified deployment

- Source: Supabase application **1.0.3**, served through Vercel.
- Destination: native application **1.1.6**, OpenShift Local project
  `vsis-timesheet`, `https://timesheet.apps-crc.testing`.
- Database: existing Docker PostgreSQL; keep the primary destination separate
  from disposable rehearsal databases.
- Email: Resend credentials supplied privately through `RESEND_API_KEY` and
  `SENDER_EMAIL`; never copy credentials into evidence.
- Window: **60 minutes**, including **15 minutes** reserved for abort/recovery.
- C08 measured **8m52.476s**; with reserve, **23m52.476s**. External reset,
  fresh login and token-reuse rejection passed. Production cutover is deferred.

See [deployment bindings](../../migrations/docs/OPENSHIFT_LOCAL_CUTOVER_PREPARATION.md)
and [reset evidence](../../migrations/evidence/c08-external-password-reset-2026-10-05.json).
Rehearsal qualification does not prove a future production freeze or authorize it.

## Prepare

1. Install locked dependencies with `npm ci`. Run `npm run migration:lint`,
   `npm run migration:typecheck`, `npm run migration:test`, and both backend builds.
2. Review [the freeze/drain runbook](../../migrations/docs/C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md).
   Confirm the chosen window, operator, recovery owner, immutable image and
   source/target database identities. Recheck aliases, cron and role bindings.
3. Protect source and destination backups. Restore into isolated databases and
   verify rows, relationships and totals before relying on a backup.
4. Supply explicitly named `MIGRATION_*` connection variables through a secure
   launcher. The CLI does not automatically load `.env.local`, or fall back to
   `DATABASE_URL`. Source export access must remain read-only.
5. Set destination site URLs, `AUTH_SECRET`, `RATE_LIMIT_SUBJECT_SECRET`, email
   transport, router trust/client-IP settings, TLS and restricted DB access.
6. Isolate pending mobile development/test queues and require fresh native login.
   Imported source passwords and sessions are not transferred.

## Rehearse

Use a disposable seeded clone with final image, role, TLS, route and email
settings. Repeat the sequence below, including backup restore, failure/replay,
enrollment/login and business smoke. Never use the primary database for rehearsal
smoke writes. Record elapsed time and recovery reserve in sanitized evidence.

## Approved cutover

Execute only after explicit production authorization. Vercel is the confirmed
sole source writer. Pause the project, prove denial at all current URLs/cron,
apply the reviewed source database fence, and prove in-flight transactions have
drained. Follow the freeze runbook for exact roles and generation-bound artifacts.
Do not substitute a read-only export or provider pause response for drain proof.

Run from `migrations/tool/`. Replace placeholders, use unused protected output
paths and a fresh run ID. `<TARGET_ENV>` names the primary destination connection
variable only during approved cutover; use a disposable variable for rehearsal.

```powershell
Set-Location migrations/tool
npm run migration -- inspect --source supabase --source-env MIGRATION_SOURCE_DB --json
npm run migration -- inspect --target native --target-env <TARGET_ENV> --json
npm run migration -- export --source supabase --source-env MIGRATION_SOURCE_DB --app-version 1.0.3 --out <bundle> --json
npm run migration -- validate --bundle <bundle> --json
npm run migration -- preflight --target native --target-env <TARGET_ENV> --target-app-version 1.1.6 --bundle <bundle> --json
npm run migration -- gate --target native --target-env <TARGET_ENV> --state fenced --run-id <run> --reason "migration import window" --actor <operator> --json
npm run migration -- plan --target native --target-env <TARGET_ENV> --target-app-version 1.1.6 --bundle <bundle> --out <preview> --json
```

Review seed overlaps, IDs, hierarchy, permission roles and dependent references.
Retain destination-only records. Write decisions outside the bundle; regenerate
and review a plan if either source/target binding or rows drift.

```powershell
npm run migration -- resolve --plan <preview> --decisions <decisions> --out <resolved> --json
npm run migration -- apply --target native --target-env <TARGET_ENV> --target-app-version 1.1.6 --plan <resolved> --expect-plan-digest <reviewed-digest> --run-id <run> --json
npm run migration -- verify --target native --target-env <TARGET_ENV> --plan <resolved> --run-id <run> --record --reason "merged state reconciled" --actor <operator> --json
npm run migration -- publish --target native --target-env <TARGET_ENV> --phase intent --run-id <run> --reason "verified publication" --actor <operator> --json
npm run migration -- publish --target native --target-env <TARGET_ENV> --phase admit --run-id <run> --reason "admit native writers" --actor <operator> --json
```

Check each exit status and receipt before advancing. Verify rows, relationships,
totals, retry history, dispositions and reviewed digests. Apply is transactional;
intent retains the fence; admission atomically opens the run's write gate.
Ordinary `gate --state open` cannot replace admission.

## Validate and recover

- After admission, validate external enrollment/reset and fresh login; create,
  edit and report a test entry; check replay and one invalid-input refusal.
- Observe native-only write authority, errors, credentials, totals and backup
  usability. Keep the source fenced and recoverable until retirement is approved.
- Before intent: restore the protected baseline or abandon the disposable target.
- At uncertain intent/admission: inspect durable receipts and journal state;
  resume the recorded run, never bypass the gate or invent a replacement run.
- After native writes: preserve and reconcile those changes before considering
  source resumption. Release the matching source fence with the approved recovery
  procedure, then the matching gate; do not blindly restore or resume Vercel.

Keep private backups/plans/decisions/journals locally. Commit only sanitized
results to `migrations/evidence/`. See the
[recovery procedure](../../migrations/docs/C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md#recovery)
for receipt and provider-fence recovery ordering.
