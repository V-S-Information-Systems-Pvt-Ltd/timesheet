# OpenShift TEST Environment Decision Packet

Date: 2026-09-28
Scope: deploy the native VSIS Timesheet backend on local OpenShift CRC in the `timesheet-test` project; keep the manifests portable to a later OpenShift production cluster. Production deployment is out of scope.

## Decision

Build a Linux image with a binary OpenShift Docker build from an explicitly filtered source directory. Publish it to a project-local ImageStreamTag. Run the native app with the existing single PostgreSQL Deployment using `Recreate` and its Bound PVC for TEST, expose the app through an edge-TLS Route, and keep runtime and first-admin credentials in separate cluster Secrets. Kustomize provides a reusable base and a CRC overlay. Do not depend on `anyuid`, privileged containers, a Windows-built standalone bundle, Docker Desktop, or an external test database.

## Why this decision is needed

The acceptance target is a reproducible HTTPS login and persistence smoke test on CRC, with a database that survives pod replacement. CRC is a single-node, resource-constrained TEST cluster; during validation its roughly 30 GiB node filesystem crossed kubelet's 15% ephemeral-storage eviction threshold while building the image, then recovered to more than 6 GiB available after build cleanup. Its internal registry is the image destination. The `developer` identity can create BuildConfigs in `timesheet-test`. The route host is `timesheet-test.apps-crc.testing`, with one trusted router hop. Cluster mutations must use the verified API context and explicit project.

## Current architecture and evidence

- FACT — `package.json` declares npm workspaces `packages/*` and `tools/*`; `prebuild` runs `scripts/verify-supabase-auth-config.mjs`, and `build` runs `next build`.
- FACT — the root `Dockerfile` uses standalone output and `COPY . .`, but omits `tools/migration/package.json` before `npm ci`; `.dockerignore` does not exclude `.env.test`. The root context therefore is not suitable for a blind binary upload.
- FACT — `next.config.ts` selects standalone output outside Vercel and transpiles the three `@vsis/*` packages. The native backend is selected at build time.
- FACT — `app/api/health/live` is dependency-free; `/api/health` checks database reachability and requires `AUTH_SECRET` of at least 32 characters.
- FACT — `lib/db/pool.ts` runs the shared migration runner on first native query. `db/seed.mjs` also invokes `db/migrate-runner.mjs`, then idempotently provisions the initial admin.
- FACT — the current `deploy/README.md` documents OpenShift edge TLS and arbitrary-UID operation, but its generic manifests use an externally supplied database; this TEST environment needs its own persistent PostgreSQL workload.
- FACT — the parent-provisioned `timesheet-postgres` Deployment is `1/1` Running, its PVC is Bound, and it uses the existing PostgreSQL Secret interface. The storage driver reports a 30 Gi capacity for the requested 1 Gi claim; actual use remains bounded by CRC's shared host disk.
- FACT — the database acceptance record reports `restricted-v2` with UID `1000650000` and GID `0`; a probe row survived a PostgreSQL Deployment restart, and the temporary probe schema was removed. Secret initialization was repeated without changing the existing three Secrets. See `deploy/openshift/database/DECISION.md`.
- FACT — the filtered OpenShift binary build succeeded as `vsis-timesheet-4` and published `vsis-timesheet:crc` at `sha256:565f041977eb6a318247ccf9af42c81e391265e531606d8f111d2c266a27ac1b`. The 2.16 MiB source context contained 347 files and passed the secret-filename scan. The image was built from the current dirty `arch/architecture-simplification` worktree at HEAD `d9f8b80aaafac1ffdc343d1b1d480544dd588cb9`; it is validation provenance, not a clean release artifact.
- FACT — the one-time seed Job completed, the migration ledger contains 37 rows for the 37 native SQL migration files, all 37 rows have checksums, and none has a null checksum.
- FACT — the application Deployment reached Ready under `restricted-v2`; the runtime identity was UID `1000650000`, GID `0`. Its dedicated ServiceAccount and all application/Job pod specs disable Kubernetes API-token automounting. The Route returned HTTPS 200 for liveness/readiness, emitted `Strict-Transport-Security: max-age=31536000`, and redirected plain HTTP.
- FACT — an authenticated browser-cookie smoke test created and read a disposable timesheet, verified it after an application Deployment restart, deleted it, then repeated the create/read test across a PostgreSQL Deployment restart and deleted it again. The protected cleanup CronJob also completed when instantiated as a one-off Job.
- FACT — build disk pressure evicted the PostgreSQL pod and the CRC hostpath CSI DaemonSet during validation. After kubelet pressure cleared, recreating only the failed CSI DaemonSet pod restored all four CSI containers, the retained PVC remounted, PostgreSQL returned Ready, and the application persistence test passed across a subsequent database pod replacement.
- INFERENCE — CRC's limited headroom favors one app replica, one database replica, modest resource requests, and a bounded cluster build; these are TEST settings, not a production availability design.

## Constraints and risks

- OpenShift restricted SCC must assign the runtime UID; image files must remain readable/writable through group 0 permissions and manifests must not request a fixed UID, privileged mode, or `anyuid`.
- A CRC hostPath-backed PVC with `Retain` is suitable only for disposable TEST data. One PostgreSQL pod is not HA and a retained volume is not a backup.
- Binary source staging must explicitly include build inputs and exclude environment files, credentials, local dependencies, generated output, tests, and unrelated documentation.
- `TRUSTED_PROXY_HOPS=1` is correct only for the current single OpenShift router hop.
- The validated BuildConfig requests 256 MiB RAM and 2 GiB ephemeral storage, with higher limits for build peaks. The Dockerfile removes npm and Next build caches in-layer. A rebuild can still trigger CRC node `DiskPressure`; operators must wait for pressure recovery and verify the hostpath CSI DaemonSet before assuming a PVC/application failure is caused by the workload manifests.
- `npm ci` reported two dependency advisories (one high, one critical) during the validation build. Their production relevance was not triaged as part of this environment-provisioning task and must be reviewed before treating the image as a production candidate.

## Alternatives considered

- Root-directory binary build: rejected because `.env.test` is not ignored by the current Docker ignore rules and unrelated/local files would be uploaded.
- Windows local standalone build: rejected because platform-specific native dependencies could be included in a Linux runtime image.
- Docker Desktop build: unavailable and would consume scarce host resources concurrently with CRC.
- External PostgreSQL for TEST: rejected because the requested environment must own persistent local Postgres and must not depend on a user's external test database.

## Production migration guidance

Keep the `DATABASE_URL` contract and app image portable. For production, prefer a supported managed PostgreSQL service or a PostgreSQL operator with HA, encrypted scheduled backups, point-in-time recovery where available, and a restore exercise. Use a production registry and immutable image digest; externalize secrets, define rotation and TLS/DNS ownership, select an approved storage class, set production capacity/replica and disruption policies, and verify restore and rollback procedures. Apply the native migrations through the established `npm run db:migrate` workflow before the application rollout where operationally appropriate; the app startup migration guard remains a safety mechanism. Never promote the CRC PVC or TEST credentials as production state.

## Acceptance checks

1. The filtered binary build completes and publishes the expected ImageStreamTag.
2. PostgreSQL and app pods become Ready under the project's restricted SCC; the PostgreSQL PVC is Bound. Database persistence through pod replacement is independently verified in `deploy/openshift/database/DECISION.md`.
3. The native migration and initial-admin seed complete against that PostgreSQL service.
4. The Route serves HTTPS at the chosen host; login succeeds, a write/read persistence smoke test succeeds, and data remains after both app pod and database pod replacement (the database Deployment remounts its PVC).
5. The runbook records image and secret operations, diagnostics, TEST cleanup, and production migration/backup/restore/rollback requirements.

## Verified result on CRC

All five acceptance checks passed on 2026-09-28. The running TEST environment uses the project-local `vsis-timesheet:crc` image, a single persistent PostgreSQL Deployment, the `timesheet-test.apps-crc.testing` edge-TLS Route, and cluster-managed Secrets. Local host HTTPS checks use certificate bypass only because the CRC wildcard certificate is not trusted by the workstation. This evidence validates the TEST topology only; it does not approve the image, database topology, certificate, credentials, storage class, or resource sizing for production.
