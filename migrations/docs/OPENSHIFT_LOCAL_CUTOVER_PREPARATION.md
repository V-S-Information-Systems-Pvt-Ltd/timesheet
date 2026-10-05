# OpenShift Local cutover preparation

Latest qualification: **2026-10-05**. The operator explicitly deferred production
cutover to a later date and authorized external password-reset validation.
This document records the selected deployment, successful local rehearsal and
remaining production gates. Historical decision/review detail is retained in
[C08 database access packet](decisions/C08_OPENSHIFT_DATABASE_ACCESS_PACKET.md)
and the linked evidence.

## Accepted deployment and boundary

| Setting | Accepted value |
| --- | --- |
| Platform | OpenShift Local on this Windows machine |
| Namespace | `vsis-timesheet` |
| Application URL | `https://timesheet.apps-crc.testing` |
| PostgreSQL container | `vsis-migration-native` |
| Primary destination | `vsis_migration_destination_20261003` |
| Primary runtime role | `vsis_timesheet_runtime` |
| Source application / target application | Supabase 1.0.3 / native 1.1.6 |
| Freeze window / recovery reserve | 60 minutes / 15 minutes |
| Rehearsal mail | Local Mailpit capture only |

The operator confirms the PostgreSQL container is dedicated to this migration
and its rehearsals. They authorized temporarily stopping the local Supabase and
performance test environments while CRC host access is enabled. Retain data,
resume exact recorded container IDs only after isolation, and do not recreate
an absent performance fixture. Vector was already unhealthy/restarting.

No production source pause/fence, primary import or writer admission is authorized
by preparation or a successful disposable rehearsal. The primary remains
unimported; retain its backups and fresh plan/review requirements.

## Qualified immutable application

Use the already qualified native standalone image:

```text
image-registry.openshift-image-registry.svc:5000/vsis-timesheet/vsis-timesheet@sha256:e3a512e1c6d90b0919d216c901372bae266cf8bd0d7f134759575186352844f1
```

Build ID: `BwTJAq7EalV6qaTNlGBFg`. Server SHA-256:
`193ada325ff83fe1354f11a807b6f77b77ce2c5f06ec5b47a9dbdb19b51e3b6d`.
Configured image user is numeric 1001; the actual namespace Pod runs as an
arbitrary permitted UID, with RuntimeDefault seccomp and no service-account
token mount. Build/package provenance is recorded in
[native 1.1.6 qualification](../evidence/c08-native-116-qualification-2026-10-04.json).
This qualifies the captured standalone artifact, not a repeat of every CI build.

## Database and network isolation

Docker retains the Windows loopback publication on port 5432. CRC Pod access
uses `host.crc.testing`; host access is enabled only for the bounded rehearsal.
TLS verifies the hostname and supplied CA. TCP uses SCRAM with narrow
runtime-role/database rules and a reject default; passwordless TCP/trust is not
restored. Controlled container Unix-socket postgres access remains the recovery
path. Wrong/missing password, plaintext and unrelated-database negative checks
passed during preparation.

Automatic migration initialization requires scoped ownership. Exactly 28
non-extension application objects are assigned to the relevant runtime role;
no blanket ownership reassignment or elevated runtime membership is used.
The primary retains canonical migration 0037. Canonical 0038 was applied only
to disposable rehearsal clones. TLS/SCRAM and all 24 primary table digests were
preserved. See [access evidence](../evidence/c08-openshift-access-2026-10-04.json).

Application credentials remain in protected operator artifacts and a dedicated
cluster Secret; do not print or copy them into repository evidence. Reject
explicit environment overrides of the Secret's credentials, compare all Secret
keys/content with the saved delivery, and verify the actual Pod database/role.
Keep the final application and native/manual cron stopped until fresh reviewed
import, verification, publication intent and atomic writer admission succeed.

## Disk expansion and rehearsal result

The operator expanded the CRC disk to 85.29 GB. Fresh node checks passed:
Ready, no DiskPressure, image registry available, and over 29 GB free before
this run. Platform cache deletion was not needed or performed. The earlier
[capacity blocker](../evidence/c08-platform-capacity-2026-10-05.json) is historical
and its cache-deletion approval request is superseded.

The fresh disposable database `c08_timing_20261005_root03`, runtime
`c08_timing_root03`, used the pinned image and final HTTPS hostname. A fresh
source export and complete semantic plan comparison matched reviewed decisions.
Transactional apply, recorded verification, seed abort restore, merged-backup
restore, authenticated fenced-write denial and atomic disposable admission
passed. The empty destination seed had no account, so the valid-actor denial
probe ran after import and before intent. All 24 merged table digests were
checked again before intent. Initial and post-denial stop/drain evidence are
retained separately.

The admitted Pod passed TLS/database/role/image checks, passwordless enrollment,
single-use reset, fresh login and business create/replay/edit/report/delete.
Each attempt starts with empty local capture, records its own migration-ledger
baseline and binds terminal success to the current admission. Failed attempts
cannot qualify final stop. Their corrections and elapsed time remain recorded.

The unchanged timer measured **8m 52.476s**, including failed attempts and
repairs. Adding the accepted 15-minute reserve gives **23m 52.476s**, within
60 minutes. Seed recovery took 4.554s and merged restore 5.838s. These are local
technical recovery measurements, not production provider recovery or a proven
source freeze. Exported source entities remained unchanged across the run;
all 24 primary and original rehearsal tables remained unchanged.

The app and capture service were stopped and their original stopped deployment
binding restored. The disposable timing database retains its admission receipts
and smoke effects; it was not restored after intent. Protected backups and
failed-attempt evidence remain. Private HTTP/reset-message scratch was removed.
See [allowlisted timing evidence](../evidence/c08-openshift-timing-2026-10-05.json)
and [passwordless enrollment](../evidence/c08-passwordless-enrollment-2026-10-05.json).
CRC is running with host access disabled; an actual Pod TCP probe timed out
(exit 124) before the exact 11 stopped test containers were restarted. Supabase
core health and a read-only database query passed. Existing Vector unhealthiness
remains. See [restoration evidence](../evidence/c08-infrastructure-restoration-2026-10-05.json).

## External mail readiness

Existing `.env.local` contains `RESEND_API_KEY` and `SENDER_EMAIL`. Native mail
already supports SMTP; no application change is needed. Runtime delivery maps:

| Native setting | Value or existing input |
| --- | --- |
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` |
| `SMTP_USER` | `resend` |
| `SMTP_PASSWORD` | Existing `RESEND_API_KEY` value |
| `SMTP_FROM` | Existing `SENDER_EMAIL` value |
| `APP_BASE_URL` | `https://timesheet.apps-crc.testing` |

[Resend SMTP documentation](https://resend.com/docs/send-with-smtp) describes
API-key authentication and verified sender requirements. Host authentication
passed. The operator authorized one test to `ixalyon@gmail.com`; SMTP accepted
it, and the operator confirmed receipt by returning its body. No reset token
or credentials were included. Final-image Pod SMTP TLS/authentication also
passed without sending mail. No further actual mail was sent during rehearsal.
External password-reset delivery and token consumption passed on 2026-10-05
through the pinned OpenShift application on a disposable fixture. Production
enrollment will still be checked after the later primary cutover.

## Production source controls and remaining inputs

Read-only Vercel inspection confirmed CLI 59.23.2, scope `vsis`, project
`timesheet` (`prj_WxsrNA1HHB3gDNuYsTi87uuW9hWl`), production deployment
`dpl_BvdaSavHeVkULA8ZnuyRYKvRCHs2`, and Git revision `0cf125a`, package 1.0.3.
Observed source aliases include `ts.kst.st`, `timesheet.kst.st`,
`timesheet-delta-rust.vercel.app`, `timesheet-vsis.vercel.app`, and
`timesheet-git-main-vsis.vercel.app`; unique deployment URL is
`timesheet-hu3zq5f7v-vsis.vercel.app`. The cleanup cron is `/api/v1/cron/cleanup`
at `0 0 * * *`. Inventory must be rechecked before actual freeze.

Installed CLI exposes `vercel project pause timesheet --scope vsis` and matching
resume. Neither was executed. Pausing Vercel does not establish a fence for
direct Supabase, dashboard/SQL or external/manual writers. See
[mail/source readiness](../evidence/c08-mail-source-readiness-2026-10-04.json)
and [production freeze/drain runbook](C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md).

Required before production work:

1. Explicit authorization for production writer controls and primary import/
   admission, with the selected cutover window.
2. Operator confirms there are no database writers outside Vercel. During
   approved cutover, retain actual Vercel denial, database fence and drain proofs;
   recheck this inventory if the deployment changes before that date.
3. Recheck source deployment/data, destination/role/image/Secret/network binding,
   usable protected backups and the fresh primary-target plan and decisions.
4. Prove exact source URL/cron denial and drain during the approved freeze.
5. Validate final external reset delivery, enrollment and business smoke after
   primary admission; retain the agreed recovery path for intent uncertainty.

A successful local timing run does not authorize production control changes.


## Operator scope update — 2026-10-05

Production cutover will occur later; no production writer control, import or
admission is authorized now. The operator confirms all writes to the source
database go through Vercel, resolving the external-writer inventory input.
External password-reset validation is authorized on the disposable OpenShift
application. Use the previously authorized recipient `ixalyon@gmail.com`.
It is absent from restored rehearsal profiles, so remap an active passwordless
profile only in that disposable clone and restore all 24 baseline tables after
testing. Do not send reset mail to another actual user or alter source/primary
profiles. Preserve the immutable app and final URL; deliver the Resend key only
in memory to a temporary cluster Secret, and remove that Secret after stopping
and restoring the original deployment binding. Return local infrastructure to
its recorded state after verifying host-access isolation.


## External reset validation completed — 2026-10-05

The actual pinned native 1.1.6 OpenShift app sent exactly one reset email through
Resend to `ixalyon@gmail.com`. The fresh provider message matched the fixture's
issued token and final HTTPS fragment link; Resend reported `delivered`. This
is provider delivery evidence, with human inbox receipt still unconfirmed.
The token was consumed by automated validation and is already used.

Wrong login returned 401, reset 200, token reuse 400, malformed token 400, fresh
login 200 and authenticated identity 200. Password installation and exactly one
session-version increment passed. Actual Pod image, effective credentials,
database, role, TLS and unchanged canonical ledger were verified.

Unconditional teardown restored all 24 clone tables, all 28 owned objects and
schema/relation/routine/type/default grants. Primary and original rehearsal rows
and privileges remained unchanged. The original stopped app binding was restored;
the temporary Secret and SMTP policy were removed. Private requests, captured
mail, raw token and generated password were deleted. No additional key-bearing
host file was saved. Restricted backups and fixed-code/status evidence remain.

Syntax, 54 offline helper guards and seven teardown failure/success cases passed.
Independent review closed unconditional cleanup and privilege restoration findings.
The existing more restrictive operator/SYSTEM directory ACL was accepted without
changing permissions. No production source control or primary admission occurred.
See [external reset evidence](../evidence/c08-external-password-reset-2026-10-05.json).


Final local restoration: CRC is Running/Ready, host access is disabled, and an
actual Pod TCP probe timed out (exit 124) before all 11 recorded test containers
were resumed. Core Supabase health and a read-only database query passed. Vector's
pre-existing unhealthy state remains. A transient CRC RAM-allocation failure
recovered on retry without changing RAM settings or stopping unrelated apps.
