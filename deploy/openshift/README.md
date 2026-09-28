# OpenShift TEST environment

This directory contains the CRC-specific build, database, and application
assets for the native VSIS Timesheet backend. The CRC environment is a TEST
target only; production must use separately approved database, storage,
registry, TLS, backup/restore, capacity, and rollout controls.

For the Supabase-backed deployment on the VSIS OpenShift cluster, see
[`PRODUCTION.md`](PRODUCTION.md).

## Target

- API: `https://api.crc.testing:6443`
- Namespace: `timesheet-test`
- Route: `https://timesheet-test.apps-crc.testing`
- Backend: `native`
- Database Service: `postgresql:5432`
- ImageStreamTag: `vsis-timesheet:crc`

Validated on 2026-09-28, build `vsis-timesheet-4` published image digest
`sha256:565f041977eb6a318247ccf9af42c81e391265e531606d8f111d2c266a27ac1b`.
That image came from the dirty `arch/architecture-simplification` worktree at
HEAD `d9f8b80aaafac1ffdc343d1b1d480544dd588cb9`; use it as TEST evidence, not as
a clean production release artifact.

The CRC wildcard certificate is normally untrusted by the Windows host. Use
certificate bypass only for local smoke tests; do not copy that practice to a
production cluster.

## 1. Initialize TEST secrets and database

From the repository root, with `oc` authenticated to the CRC cluster:

```powershell
oc project timesheet-test
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/openshift/database/Initialize-TestSecrets.ps1
oc apply -k deploy/openshift/database
oc rollout status deployment/timesheet-postgres --timeout=300s
```

`Initialize-TestSecrets.ps1` is intentionally create-once. Existing Secrets
are retained. If the database PVC exists but the database Secret is missing,
the script stops instead of inventing new credentials for existing data.

## 2. Build the application image

The root repository must not be uploaded directly. `.env.test` and other local
files can exist outside the filtered build context.

```powershell
oc apply -k deploy/openshift/build/overlays/crc
$context = powershell -NoProfile -ExecutionPolicy Bypass -File deploy/openshift/scripts/package-source.ps1 | ConvertFrom-Json
oc start-build vsis-timesheet --from-dir=$context.ContextDirectory --follow
oc get istag vsis-timesheet:crc
```

The BuildConfig declares modest CPU/RAM requests and a 2 GiB ephemeral-storage
request. CRC is a single-node development cluster; if kubelet reports
`DiskPressure`, do not repeatedly retry. Wait for pressure to clear, remove only
completed/failed build pods that are no longer needed, and re-check node free
space. The Dockerfile removes npm and Next build caches in the same layers to
reduce peak build storage.

## 3. Run the one-time bootstrap seed

Apply the dedicated ServiceAccount and base ConfigMap before the seed Job. The
application Deployment intentionally does not receive the bootstrap password.

```powershell
oc apply -f deploy/openshift/app/base/serviceaccount.yaml
oc apply -f deploy/openshift/app/base/configmap.yaml
oc delete job vsis-timesheet-seed --ignore-not-found=true
oc apply -f deploy/openshift/app/seed-job.yaml
oc wait --for=condition=complete job/vsis-timesheet-seed --timeout=300s
oc logs job/vsis-timesheet-seed
```

`db/seed.mjs` applies the native migrations through the shared advisory-locked
migration runner and then provisions the bootstrap administrator. Do not rerun
the seed on every application rollout: it intentionally updates the admin
password hash when rerun.

To retrieve the TEST bootstrap credentials when an operator actually needs
them, run this interactively. It prints secret values to the caller's terminal:

```powershell
oc extract secret/vsis-timesheet-bootstrap --keys=ADMIN_EMAIL,ADMIN_PASSWORD --to=-
```

Do not paste those values into manifests, logs, tickets, or source files.

## 4. Deploy the application

```powershell
oc apply -k deploy/openshift/app/overlays/crc
oc rollout status deployment/vsis-timesheet --timeout=300s
oc get route vsis-timesheet
```

The CRC overlay points all app/cron image references at the project-local
internal registry and sets `APP_BASE_URL` plus the fixed TEST Route host. The
Route terminates TLS at the OpenShift router and uses a 180-second backend
timeout so long-running restore requests are not cut off before the browser
client's 120-second deadline. The application, seed, cleanup, and smoke pods
use a dedicated ServiceAccount with API-token automounting disabled.

## 5. Verify the environment

Basic health and security checks:

```powershell
curl.exe -k -sS https://timesheet-test.apps-crc.testing/api/health/live
curl.exe -k -sS https://timesheet-test.apps-crc.testing/api/health
oc get pods
oc get pvc timesheet-postgres-data
```

Confirm the app pod uses the restricted SCC and an arbitrary UID:

```powershell
$pod = oc get pod -l app.kubernetes.io/name=vsis-timesheet -o jsonpath='{.items[0].metadata.name}'
oc get pod $pod -o jsonpath='{.metadata.annotations.openshift\.io/scc}{"`n"}'
oc exec $pod -- id
```

For a local-only browser/API smoke test, use the bootstrap credentials, keep a
cookie jar, and send unsafe requests with an `Origin` matching the Route host.
After creating a disposable record, read it back, restart the app Deployment,
read it again, and remove the disposable record. Separately verify the database
PVC by replacing the PostgreSQL pod and confirming the record remains.

The checked-in smoke Jobs perform this without printing the bootstrap password:

```powershell
oc delete job vsis-timesheet-smoke-create --ignore-not-found=true
oc apply -f deploy/openshift/app/smoke-create-job.yaml
oc wait --for=condition=complete job/vsis-timesheet-smoke-create --timeout=180s
oc logs job/vsis-timesheet-smoke-create

oc rollout restart deployment/vsis-timesheet
oc rollout status deployment/vsis-timesheet --timeout=180s

oc delete job vsis-timesheet-smoke-verify --ignore-not-found=true
oc apply -f deploy/openshift/app/smoke-verify-job.yaml
oc wait --for=condition=complete job/vsis-timesheet-smoke-verify --timeout=180s
oc logs job/vsis-timesheet-smoke-verify
```

To validate PVC persistence instead, run the create Job, restart
`deployment/timesheet-postgres`, wait for it to become Ready, then run the same
verify Job. The verify Job deletes the disposable marker after confirming it
survived the restart.

The validated migration ledger contained 37 rows for 37 native migration
files, with a non-null checksum on every row.

The cleanup endpoint should reject a missing/incorrect secret. To test the
configured scheduled cleanup without exposing the secret, create a Job from the
CronJob and inspect only its exit status/log message:

```powershell
oc create job --from=cronjob/vsis-timesheet-cleanup vsis-timesheet-cleanup-smoke
oc wait --for=condition=complete job/vsis-timesheet-cleanup-smoke --timeout=180s
oc logs job/vsis-timesheet-cleanup-smoke
oc delete job vsis-timesheet-cleanup-smoke
```

The success path is intentionally quiet; Job completion is the success signal.
During the 2026-09-28 validation run this one-off cleanup Job completed.

### CRC disk-pressure recovery

Image builds can temporarily cross CRC's node ephemeral-storage eviction
threshold. If PostgreSQL subsequently reports a PVC mount error stating that
`kubevirt.io.hostpath-provisioner` is not registered, inspect the
`hostpath-provisioner` namespace before changing application/database
manifests. During validation the hostpath CSI DaemonSet itself had been evicted;
after node `DiskPressure` cleared, deleting only its failed pod allowed the
DaemonSet to recreate 4/4 Ready containers and PostgreSQL remounted the retained
PVC successfully.

## Production migration requirements

Do not promote the CRC PVC, CRC wildcard certificate, TEST Secrets, or a dirty
working-tree image as production state. Production should use a managed or
operator-managed HA PostgreSQL deployment, trusted TLS/DNS, immutable image
digests from an approved registry, rotated production Secrets, approved storage
and resource sizing, monitored backups, a restore exercise, and an explicit
cutover/rollback plan. Verify native migrations against the production target
before rollout and preserve the established `DATABASE_URL` contract.
