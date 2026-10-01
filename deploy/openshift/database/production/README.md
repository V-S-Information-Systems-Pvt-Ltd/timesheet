# Production PostgreSQL target

The database for `timesheet-vsis` is an independent CloudNativePG `Cluster`.
The ODF CloudNativePG controller installed in `openshift-storage` watches only
that namespace, so this project installs the certified CloudNativePG operator
with a single-namespace OperatorGroup. Operator upgrades use manual approval.

From the repository root, with `oc` logged into the production cluster:

```powershell
oc apply -f deploy/openshift/database/production/operator.yaml
oc get installplan -n timesheet-vsis
```

Inspect the pending plan and confirm its sole CSV is
`cloudnative-pg.v1.30.1`, then approve that plan and deploy the cluster:

```powershell
oc patch installplan <plan-name> -n timesheet-vsis --type=merge -p '{"spec":{"approved":true}}'
oc wait csv/cloudnative-pg.v1.30.1 -n timesheet-vsis --for=jsonpath='{.status.phase}'=Succeeded --timeout=300s
oc apply -f deploy/openshift/database/production/cluster.yaml
oc apply -f deploy/openshift/database/production/networkpolicy.yaml
```

The cluster creates the private read/write Service
`timesheet-postgres-rw` and the generated application credential Secret
`timesheet-postgres-app` in `timesheet-vsis`. Never commit or print Secret values.

The PostgreSQL workload has three instances with 20 GiB RBD volumes each.
The version and image digest are pinned. TLS certificates are managed by the
operator. The ingress policy permits traffic from pods in `timesheet-vsis` and
blocks ordinary cross-namespace ingress. The existing app remains on Supabase
until migration and cutover checks pass. All three instances are currently
healthy, with two streaming replicas, but they occupy only two workers. A
required one-per-worker rule could not schedule the third instance at the
configured resource requests; resolve worker capacity before relying on
three-node fault isolation.

Verify all three instances are ready, the three PVCs are bound, and a TLS
connection to `timesheet-postgres-rw:5432` can execute a read-only query:

```powershell
oc get clusters.postgresql.cnpg.io timesheet-postgres -n timesheet-vsis
oc get pods,pvc -n timesheet-vsis -l cnpg.io/cluster=timesheet-postgres
oc apply -f deploy/openshift/database/production/connectivity-check.yaml
oc wait job/timesheet-postgres-connectivity-check -n timesheet-vsis --for=condition=complete --timeout=180s
oc logs job/timesheet-postgres-connectivity-check -n timesheet-vsis
```

The check queries the read/write Service using `sslmode=verify-full` and only
mounts the CA certificate, not its private key. It prints database name,
database user, and whether TLS was used. The Job expires after one hour.

Take and inspect an initial snapshot:

```powershell
oc apply -f deploy/openshift/database/production/initial-snapshot.yaml
oc get backup.postgresql.cnpg.io,volumesnapshot -n timesheet-vsis
```

The initial empty-cluster snapshot is
`backup.postgresql.cnpg.io/timesheet-postgres-initial-snapshot`; it completed
on 2026-09-28 in the first production deployment. Configure
scheduled backups and off-cluster retention, then perform a restore exercise
before moving production writes. Ceph volume snapshots alone are not an
off-cluster recovery copy.

To prepare a fresh target schema, keep this port-forward open in one terminal:

```powershell
oc port-forward -n timesheet-vsis svc/timesheet-postgres-rw 15432:5432
```

In another PowerShell terminal at the repository root, run the shared native
migration runner. The password is read from the operator-generated Secret and
is kept in process memory only:

```powershell
$secret = oc get secret timesheet-postgres-app -n timesheet-vsis -o json | ConvertFrom-Json
$decode = { param($key) [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($secret.data.$key)) }
$user = [uri]::EscapeDataString((& $decode 'username'))
$password = [uri]::EscapeDataString((& $decode 'password'))
$database = [uri]::EscapeDataString((& $decode 'dbname'))
$env:DATABASE_URL = "postgresql://${user}:${password}@127.0.0.1:15432/$database"
try { npm run db:migrate } finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Variable secret,decode,user,password,database -ErrorAction SilentlyContinue
}
```

Close the port-forward when the migration completes. The native schema was
applied through this repository's `db:migrate` command;
`public.schema_migrations` contains 37 checksummed rows and the destination's
profiles and timesheets remain empty. A separate
`pre-import-snapshot.yaml` captures that schema-only state before the data
transfer. Apply it only after migrations complete, then confirm the Backup and
VolumeSnapshot both report completion before importing source data:

```powershell
oc apply -f deploy/openshift/database/production/pre-import-snapshot.yaml
oc get backup.postgresql.cnpg.io,volumesnapshot -n timesheet-vsis
```
