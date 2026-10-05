# Migration dry run — actual source data

Updated 2026-10-04. This is Dry run in the
[active four-stage plan](SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md).
Use one protected actual-source-data rehearsal on disposable seeded native.
No production freeze/apply/provider operation is authorized by this runbook.
The [previous C08 body](archive/C08_REHEARSAL_RUNBOOK_2026_10_04.md) is historical;
its synthetic/long-horizon/full reverse certification is not the current gate.

## Preparation

- Record source binding, disposable target identity, exact release/commit,
  operator/run id, protected artifacts and recovery owner. Production source
  binding was operator-confirmed on 2026-10-04; reconfirm changed bindings.
- Securely load named `MIGRATION_*` variables without logging values, or use an
  existing safe env-file launcher. CLI entry/npm does not auto-load `.env.local`.
  Never print or copy environment values into evidence.
- Run commands from `migrations/tool/`. Replace angle-bracket placeholders.
  `<MIGRATION_NATIVE_DB>` is an explicit operator-configured `MIGRATION_*`
  variable bound to disposable native (final native only during an approved
  cutover), **not** `MIGRATION_DESTINATION_DB` / hosted `timesheet-test` recovery.
- Source application is **1.0.3**; user selected **native 1.1.6** for qualification.
  Complete the explicit directional compatibility checks in
  [the decision packet](decisions/C08_RESUME_PACKET.md) before planning/apply.
  Keep export metadata at 1.0.3 and declare target 1.1.6 explicitly. Arbitrary
  releases and other newly implied transitions remain refused. Final host and
  enrollment remain open. The earlier 1.0.3 compatibility smoke does not qualify
  the selected 1.1.6 runtime.
- Native runtime needs `AUTH_SECRET` and `RATE_LIMIT_SUBJECT_SECRET`, correct
  site URLs and SMTP configuration. Configure actual `TRUSTED_PROXY_HOPS` for
  the final ingress. For this direct-loopback rehearsal only, explicitly use
  `ALLOW_UNTRUSTED_CLIENT_IP=true`; bind app and mail sink to loopback. The
  fresh rehearsal recovered missing launcher settings without changing the app.
- Preserve protected source backup and native seeded baseline. Restore into an
  isolated disposable database and reconcile to prove usability. Existing
  [backup evidence](archive/C00_BACKUP_AND_UPGRADE_READINESS.md) and
  [source restore](archive/C00_SUPABASE_SOURCE_RESTORE.md) have bounded scope.
- Seed disposable native like final: 45 projects, 5 activities, 6 titles/settings.
  Review [overlaps and hierarchy findings](archive/C00_LIVE_INVENTORY_2026_10_03.md).
  Protect actual data; dispose only owned rehearsal artifacts afterwards.
- Rehearse [writer controls](C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md) and drain on
  disposable infrastructure. Read-only export alone is not freeze proof. Never
  pause the shared production Vercel project as a preview rehearsal.

## Operator sequence

Reuse this sequence at approved cutover with a **fresh final** bundle/plan after
source stop/deny/drain. Here, source access is read-only; destination writes,
publication and smoke are disposable. Check command success before advancing;
stop on stale plans, unresolved conflicts, failed reconciliation or uncertain
receipts. Output paths must be unused; plans/decisions stay outside the bundle.

```powershell
npm run migration -- inspect --source supabase --source-env MIGRATION_SOURCE_DB --json
npm run migration -- inspect --target native --target-env <MIGRATION_NATIVE_DB> --json
npm run migration -- export --source supabase --source-env MIGRATION_SOURCE_DB --app-version 1.0.3 --out <protected-bundle> --json
npm run migration -- validate --bundle <protected-bundle> --json
npm run migration -- preflight --target native --target-env <MIGRATION_NATIVE_DB> --target-app-version 1.1.6 --bundle <protected-bundle> --json
npm run migration -- gate --target native --target-env <MIGRATION_NATIVE_DB> --state fenced --run-id <run-id> --reason "migration import window" --actor <operator> --json
npm run migration -- plan --target native --target-env <MIGRATION_NATIVE_DB> --target-app-version 1.1.6 --bundle <protected-bundle> --out <protected-preview.json> --json
npm run migration -- resolve --plan <protected-preview.json> --decisions <protected-decisions.json> --out <protected-resolved.json> --json
npm run migration -- apply --target native --target-env <MIGRATION_NATIVE_DB> --target-app-version 1.1.6 --plan <protected-resolved.json> --expect-plan-digest <reviewed-plan-digest> --run-id <run-id> --json
npm run migration -- verify --target native --target-env <MIGRATION_NATIVE_DB> --plan <protected-resolved.json> --run-id <run-id> --record --reason "merged state reconciled" --actor <operator> --json
npm run migration -- publish --target native --target-env <MIGRATION_NATIVE_DB> --phase intent --run-id <run-id> --reason "verified publication" --actor <operator> --json
npm run migration -- publish --target native --target-env <MIGRATION_NATIVE_DB> --phase admit --run-id <run-id> --reason "admit native writers" --actor <operator> --json
```

Inspect preview and produce reviewed decisions before resolve. Confirm seed-name/
ID mappings, project/activity fields, title/hierarchy classification, both role
axes and dependent references; retain destination-only rows. Regenerate/review
stale plans. Record and recheck the reviewed resolution digest as well as the
plan digest before apply. Keep transactional import, receipt/provenance/disposition and retry
contracts. Do not bypass fences or split transactions to meet timing.

Verify rows, relationships/totals, mappings, dispositions and retry history against
the resolved expected state and persist the verified receipt. Require no row
drift on receipt replay, including when apply reports a no-op. Intent keeps
writers fenced; admit atomically records writable state and opens that run's gate.
Ordinary `gate --state open` is refused.

## Smoke, timing and recovery evidence

After rehearsal admission, prove destination enrollment/reset and fresh login,
create a timesheet, edit it and check report totals. Exercise a representative
failure/refusal without unintended durable mutation. Source passwords/sessions
are excluded; matched destination credentials remain. Settle/isolate mobile
dev/test queues and require fresh native login; mobile is not in production,
and remapped queue replay is not assumed.

Any pre-intent business smoke belongs to a **separate disposable rehearsal clone**
that is discarded. No persisted business smoke writes on final native before
`verify --record` → intent → admit. Do not invalidate the reviewed import baseline.

Record operator-visible timing for simulated stop/drain, final export, validation,
fresh plan/review, transactional apply, verification/publication and agreed abort
allowance. The user reserved 15 minutes for abort/recovery, leaving 45 minutes
for the normal sequence including review. Prove actual-data fit in the accepted
60-minute freeze; a miss blocks
the window until revision. RPO 120 / RTO 720 minutes are prior goals, not results.

Prove protected backup restore/reconciliation and pre-intent abort on disposable
infrastructure: native stays isolated; restore known seeded baseline or abandon
disposable native. Release the exact provider artifact with `--recovery` before
matching source gate recovery. Follow [recovery](C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md#recovery)
for intent uncertainty or later native writes; no source-return bypass is allowed.

Retain redacted timings, bindings, decisions/digests, restore results, receipt/
gate states, denial/drain and smoke outcomes. A successful dry run is evidence
for final approval, not production authorization. Staging/FDW, synthetic volume/
RSS/disk/max-row, full reverse/provider recovery, long-horizon/real-device and
off-host retention certification are **not required for this cutover**, not PASS.
Usable restore and actual fit remain required.

## Completed native 1.1.6 rehearsal

[Fresh qualification evidence](../evidence/c08-native-116-qualification-2026-10-04.json)
records Supabase application 1.0.3 → native application 1.1.6 with an unchanged
clock: 33m 36.376s, including review and recovered launcher failures. With the
15-minute reserve, 48m 36.376s fits the accepted 60 minutes. Apply, zero-drift
replay, merged/abort restores, local publication and enrollment/business smoke
passed. Production source and original seed remained unchanged. Final production
host/artifact, proxy configuration, external mail and writer controls remain open.


## Completed local OpenShift rehearsal — 2026-10-05

[OpenShift timing evidence](../evidence/c08-openshift-timing-2026-10-05.json)
records 8m 52.476s on the continuously running clock, including repairs/retries;
23m 52.476s with the accepted 15-minute reserve. Fresh data/decision parity,
apply/verify, both restores, fenced authenticated denial, disposable admission,
final-host enrollment and business smoke passed. Initial and post-denial
stop/drain records are retained separately. All 24 merged digests were checked
before intent. Each attempt uses empty local mail capture and its own ledger
baseline; terminal success is bound to current admission. Failed attempts cannot
qualify final stop. No post-intent database restore was performed. Production
source freeze/drain and primary cutover approval remain open. External reset
validation on the pinned disposable OpenShift app passed on 2026-10-05; see [preparation](OPENSHIFT_LOCAL_CUTOVER_PREPARATION.md).


External SMTP reset validation is recorded in
[reset evidence](../evidence/c08-external-password-reset-2026-10-05.json): one message,
provider delivery, token consumption/reuse rejection, fresh login, and complete
clone data/ownership/privilege restoration. Cutover remains explicitly deferred;
the operator confirms Vercel is the sole source database writer.
