# CRC database decision

Decision: provision a namespace-private PostgreSQL 15 database for `timesheet-test` with a 1 GiB PVC and a digest-pinned Red Hat image compatible with arbitrary OpenShift UIDs. This is test infrastructure; it is not a production HA database template.

Evidence: the existing native `db/seed.mjs` calls `db/migrate-runner.mjs`, applies migrations under advisory lock and upserts the bootstrap account. The cluster provides PostgreSQL 15 in `openshift/postgresql:15-el9`; its resolved digest is recorded in `postgres.yaml`. CRC has about 5.7 GB available disk and a default host-path storage class with Retain reclaim policy and no expansion. No external application database is accessed.

Lifecycle: generate secrets once before creating the PVC; preserve them on subsequent runs. Refuse to invent database credentials when a PVC exists but its secret is missing. Apply the database, wait for readiness, then run the application's migration/seed bootstrap as a separately controlled Job. Recreate deployment strategy prevents two PostgreSQL servers from mounting the same data directory concurrently. Do not delete the PVC on rollout or failure. Storage is local to CRC and survives pod replacement, but not loss of the CRC VM.

Alternatives: an external production database is out of test scope; Docker Desktop is stopped; a database operator is unnecessary for this resource-constrained local instance. Production promotion requires an operator-managed HA or managed PostgreSQL service, trusted TLS, a tested database dump/restore, new secrets, monitored backups and explicit cutover/rollback procedures. A CRC PVC must not be treated as a portable backup.

Checks: server dry-run; database Ready with restricted SCC and arbitrary UID; seed migrations; application login and mutation round-trip; verify a test record survives PostgreSQL pod replacement. Secrets are sent directly to the cluster and are not written into manifests, build contexts or logs.

Reference: [Red Hat PostgreSQL container conventions](https://catalog.redhat.com/software/containers/rhel8/postgresql-15/63d29a05fd1c4f5552a305b3) and [OpenShift arbitrary UID support](https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/images/creating-images).

## Verified on CRC, 2026-09-28

- Server dry-run and apply accepted all five database resources.
- PostgreSQL became Ready with `restricted-v2`, UID `1000650000`, group `0`.
- PVC requested 1 GiB; CRC's hostpath provisioner reports 30 GiB capacity. This does not create extra physical storage; monitor the CRC VM's free disk.
- Created a temporary probe table, inserted one marker, restarted the PostgreSQL Deployment, and read the same marker from the new pod. Removed only that temporary table/schema after the successful check.
- Re-running `Initialize-TestSecrets.ps1` preserved all three existing Secrets without printing credential values.
