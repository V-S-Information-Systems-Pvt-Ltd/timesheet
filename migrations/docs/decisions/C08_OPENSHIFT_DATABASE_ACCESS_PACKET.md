# C08 OpenShift access to existing Docker PostgreSQL

## Decision required

How should OpenShift Local connect to the selected existing Docker PostgreSQL
without exposing its current passwordless superuser access? Review the proposed
protocol before changing host networking or authentication. This is preparation,
not production cutover authorization.

## Constraints and verified evidence

- FACT: operator chose OpenShift Local, namespace `vsis-timesheet`, hostname
  `timesheet.apps-crc.testing`, retaining database
  `vsis_migration_destination_20261003` in `vsis-migration-native`.
- FACT: Docker publishes PostgreSQL 16 only on Windows `127.0.0.1:5432`.
  Read-only HBA inspection found `host all all all trust`. The sole login role
  is `postgres`, a superuser with no password. TLS is off. Only the inspection
  psql session was active when inspected; this does not prove absence of other
  intermittent consumers.
- FACT: CRC `host-network-access` defaults to false. An existing controller pod
  resolves `host.crc.testing` to `192.168.127.254`; a bounded TCP connection to
  port 5432 timed out. No database credentials were sent.
- FACT: CRC now reports OpenShift 4.22.1 Running, node DiskPressure false and
  machine-config Degraded false / Available true. Writable filesystem reports
  50 GiB with 16 GiB available. Earlier pressure/degradation was observed; the
  root did not resize storage or remove data.
- FACT: `lib/db/pool.ts:getPool/ensureMigrated` uses the runtime DATABASE_URL
  and runs migrations at first use. `db/migrate-runner.mjs:runMigrations` always
  creates/alters schema_migrations, so a read/write-only role is insufficient
  even on an already migrated database. Do not introduce an app code change.
- FACT: existing application deployment starts one replica and native cron
  can write. Keep both stopped and destination fenced until the import/admission
  protocol permits them (`deploy/deployment.yaml`, `deploy/README.md`).
- FACT: prior C08 qualification used disposable databases and a loopback runtime.
  It does not qualify a new deployed network/role/TLS binding.

The task is already scoped to these files and live operator facts; source was
inspected directly. No graph-derived inference is used.

## Alternatives

1. Enable host access immediately, keeping trust: reject, because any reachable
   cluster client could impersonate the PostgreSQL superuser.
2. Harden the existing container before enabling access: preferred candidate,
   subject to consumer inventory and operator approval of changed credentials.
   Preserve all databases/data and host loopback binding. Establish protected
   credential and HBA backups; create an authenticated runtime role scoped to
   the chosen database with ownership needed by automatic migrations. Keep
   administrative import separate from runtime. Require SCRAM for every TCP
   path, including any Docker-forwarded path seen as loopback; retain the local
   Unix socket only for controlled container administration. Confirm TLS or a
   protected transport decision before certifying the final connection.
   Enable CRC host-network-access and restart CRC only after authentication
   failure/success checks prove the trust path is closed.
3. Move PostgreSQL into OpenShift: would contradict the confirmed destination
   choice; do not switch silently.

## Lifecycle and rollback requirements

- Activation: inventory consumers; capture target backups and permission/HBA
  state; prepare credentials without shell/log disclosure; verify rollback
  access through the container Unix socket. No source writer controls change.
- Normal completion: verify no/wrong password fails, correct role succeeds,
  superuser impersonation fails, unrelated databases are denied, application
  migration initialization succeeds, and application/operator bind to the same
  final database. Deliver connection through a cluster Secret only.
- Recovery: disable CRC host access before restoring any trust-era HBA state;
  restart CRC as necessary, preserve data and revoke only newly owned grants/
  roles after proving no active consumer. Never restore trust while pods can
  reach it. Record exact configuration/credential changes, not secret values.
- Retries/stale artifacts: use a unique protected preparation directory, reject
  pre-existing role/config ownership conflicts and never silently replace a
  generated credential or an operator-modified HBA. Fresh final migration plan
  required; do not reuse the disposable C08 plan.
- Concurrency: do not alter shared-container authentication while unknown
  consumers are active; stop the app and cron throughout preparation. Recheck
  HBA and role state before mutation and retain the administrative recovery path.

## Unknowns and acceptance checks

- RESOLVED INPUT: operator confirms the container is used only for this
  timesheet migration and its rehearsals. Update their protected credentials
  together when hardening; no other application consumers are reported.
- UNKNOWN: exact Docker-forwarded client address from a normal application pod.
- UNKNOWN: transport protection and native client certificate delivery.
- UNKNOWN: complete ownership/grant requirements of existing target schema;
  validate in an isolated clone before changing the selected primary.
- No production import, source pause, public publication or final admission is
  authorized by this packet.

## Initial review ledger

Independent read-only review conditionally endorses hardening the existing
container and requires the following before CRC access is enabled:

| ID | Failure scenario | Required closure | Status |
| --- | --- | --- | --- |
| OA1 | SCRAM passes but database traffic is plaintext | Server-authenticated TLS, CA/hostname checks and plaintext rejection using installed Node pg | Disposable TLS 1.3 and negative matrix passed; primary fresh TLS/auth checks passed; actual pod client pending |
| OA2 | Readiness passes but runtime migration DDL fails, or grants reach unrelated databases | Explicit scoped ownership, real migration initialization, unrelated database denial | 28 non-extension application objects transferred on clone; canonical 0038 plus no-op and real pool initialization passed; primary owns same scoped objects with unchanged data |
| OA3 | Credential changes break unknown consumers or cluster restart interrupts unrelated apps | Operator consumer inventory and non-platform workload inventory | Operator confirms migration/rehearsal only; CRC inventory shows only hostpath provisioner, no user app workload |
| OA4 | Trust rollback occurs while pods or established sessions still connect | Prove network denial and session drain first; prefer retaining hardened authentication | Host access disabled and pod TCP denial verified; stopped workloads/no port-forward; hardened auth retained; full recovery timing pending |

Runtime role ownership inventory on the selected primary shows 24 public tables,
58 indexes and 40 public functions owned by postgres; the database is also owned
by postgres. Ownership changes must enumerate non-extension application objects
in the selected database and be proven on the clone. Do not use blanket
REASSIGN OWNED or transfer shared database objects.

The root chose verified TLS and SCRAM for the bounded disposable qualification.
The implementation worker may create only its uniquely named isolated container,
clone and protected evidence. Root took back ownership after the worker's
initialization failure and executed the repaired isolated run.

## Integration evidence

The repaired disposable run passed seven stages and eleven matrix checks.
Supplemental assertions verify role flags, zero memberships, exact missing-
password SCRAM diagnostic, TLS authorization and unchanged primary digests. The
sole restored public definer function is `team_ids`, with public search_path
and profiles dependency; function and table share runtime ownership on the clone.

After independent closure review and operator confirmation that the container
is dedicated, root hardened the selected primary. Configuration, credentials,
ownership manifests and dump are in a unique protected directory. The primary
requires TLS/SCRAM, gives the runtime role scoped application ownership, retains
Unix-socket postgres administration and permits authenticated postgres operator
TCP access. Wrong passwords, plaintext and runtime access to unrelated databases
are rejected. All 24 public-table row digests are unchanged; no primary migration
or import was applied. CA private keys and dumps are not mounted into the primary
or intended application pod. Actual pod/client certificate validation is pending.

Operator authorized temporarily stopping the local Supabase and performance
test containers, preserving their data, before enabling global CRC host access
and restarting CRC. Those services are stopped. Source production remains
unchanged. See [sanitized evidence](../../evidence/c08-openshift-access-2026-10-04.json).

Final OA4 closure: rehearsal workloads and port-forward are absent, CRC host
access is restored to its disabled default and the pod TCP denial probe exits
124 before Supabase services resume. Hardened authentication is retained; no
trust restoration occurred. This does not certify full new-platform recovery
timing. The restored-backup host review found no material defect; first-time
passwordless enrollment and fresh migration admission remain separate checks.

## Requested review

### Continuation: pod mail authentication and passwordless enrollment

Root owns the operational helper delta. Final-image SMTP authentication uses a
diagnostic pod with no database binding, no service-account token and no ingress.
Only DNS and public TCP 465 egress are allowed. The existing Resend key is passed
through non-TTY stdin to a fixed Node TLS client with no SMTP logging;
no credential file, Pod environment or Secret is created, and no mail is sent.
The Next.js image bundles Nodemailer without a separately resolvable module;
the diagnostic therefore validates TLS/EHLO/AUTH PLAIN only, never MAIL FROM or
RCPT TO. Application transport remains qualified through the capture flow.
Delete the owned pod and policy on success or failure.

For enrollment, reuse only the stopped, owned clone and capture-only workloads.
Recheck image, clone database/role and mail bindings before activation. Select an
active account whose password hash is actually NULL; require failed initial
login, a newly captured message to that account with the final-host link,
successful reset, token-reuse rejection and fresh login. Restore the complete
owned dump after scaling down and draining sessions, then compare all 24 tables
and primary digests. Retain TLS/SCRAM and disable host access before resuming the
exact paused test containers. Snapshot container IDs/health before stopping.

Initial independent delta review found no established material defect and
required these execution assertions. External final-pod delivery and fresh
OpenShift freeze/recovery timing remain separate qualifications. The absent
performance fixture and Vector restart exception must not be silently repaired
or reported healthy. Production source controls remain untouched.

Give a bounded recommendation and blocking findings with FACT / INFERENCE /
UNKNOWN labels and cited files. Assess authentication ordering, role ownership,
transport security, shared consumers, restart impact and recovery. Return at
most 800 words. Do not modify files or external state.

## Primary documentation

- [CRC networking](https://crc.dev/docs/networking/)
- [CRC user-mode host access](https://crc.dev/engineering-docs/Usermode-networking-stack.html)
- [PostgreSQL 16 trust authentication](https://www.postgresql.org/docs/16/auth-trust.html)
- [PostgreSQL 16 password authentication](https://www.postgresql.org/docs/16/auth-password.html)


## Execution closure — 2026-10-05

Historical pending platform/pod/enrollment/timing checks above are superseded
by successful disposable OpenShift qualification. The expanded disk removed
DiskPressure without platform cache deletion. Effective Pod database/role/TLS,
image/UID/security, passwordless final-host enrollment and business smoke passed.
Fresh canonical import, both restores, all-24 pre-intent comparison and atomic
disposable admission passed in 8m 52.476s with an unchanged clock.
15-minute reserve gives 23m 52.476s. Independent reviews closed HBA replacement,
credential-override, partial binding and stale smoke-evidence findings.
Production source controls and primary cutover remain unapproved. Final external
reset delivery is separate. See the current preparation and sanitized timing
and infrastructure restoration evidence.
