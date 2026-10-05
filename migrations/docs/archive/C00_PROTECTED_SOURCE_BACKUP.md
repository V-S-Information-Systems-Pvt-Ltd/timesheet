# Protected Supabase source backup — 2026-10-03

> Archived 2026-10-04 as supporting reference. Recorded evidence, contracts and
> unverified limitations retain their scope; this move marks no pending check complete.
> Current work follows the [active plans](../../../docs/README.md#active).

Status: **CAPTURE AND SCOPED LOGICAL RESTORE VERIFIED.** The
operator explicitly approved capture and encrypted local retention after
automatic approval review requested clearer authorization. No source data/schema
write, provider fence, email or cutover ran. A later restore into the separate
timesheet-test recovery project passed; full platform recovery remains open.

## Captured artifacts

Private directory:
`C:\Users\kasku\AppData\Local\Temp\vsis-source-backup-HZTcZD`.
Windows ACLs restrict the directory to the current account, SYSTEM and local
Administrators. Files use Windows DPAPI CurrentUser protection. Neither a raw
SQL dump nor record bodies were persisted in repository evidence.

| Artifact | Scope | Integrity |
| --- | --- | --- |
| source-data-schema.dpapi | One PostgreSQL custom archive of public, auth, storage and supabase_migrations; owners and ACLs included | Raw 556,426 bytes; protected 556,646 bytes; decrypted SHA-256 matched |
| source-role-metadata.dpapi | 31 role definitions and 25 membership rows from pg_roles/pg_auth_members; password hashes excluded | Decrypted SHA-256 matched |

The archive TOC was parsed privately and includes data entries for Auth users,
Auth identities, profiles, timesheets, storage objects and migration history.
At capture time this confirmed archive inventory, not restore or account usability.
The later restore verification below adds scoped recovery evidence.
Role metadata is a separately observed reference, not part of the archive's
shared data snapshot or an executable role/password recovery script.

The PostgreSQL client and source are both major version 17. A verified TLS
connection used the production CA linked by Supabase's official dashboard
source and sslmode=verify-full. No trust store or server SSL setting changed.
The pooler's internal server hop reports SSL false in pg_stat_ssl; this is a
different connection from the verified client-to-pooler TLS connection.
The read probe used an explicit read-only transaction. pg_dump performs its
consistent read transaction; a pooler need not preserve libpq startup PGOPTIONS.

Storage object metadata count was zero at the preflight observation. No object
file payload was captured. The archive retains profiles.full_name for original
source recovery even though portable migration deliberately omits it under its
snapshot-bound equivalence guard.

## Evidence and limitations

- [Protected capture evidence, paths, sizes and hashes](../../evidence/c00-protected-source-backup-2026-10-03.json)
- [Initial metadata/TLS preflight](../../evidence/c00-source-backup-preflight-2026-10-03.json)
- [Decision and authorization packet](../decisions/C00_SOURCE_BACKUP_PACKET.md)
- [Later logical restore result and limits](C00_SUPABASE_SOURCE_RESTORE.md)
- [Independent recovery verification](../../evidence/c00-supabase-source-restore-verification-2026-10-03.json)
- [Supabase CA source](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json)
- [Provider restore considerations](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

DPAPI recovery requires the same Windows account/profile. A temporary directory
has no guaranteed retention and is not off-host storage. Decide durable/off-host
retention and authorized recovery access before calling the backup recoverable.
API/JWT/Vault encryption roots, platform settings, Edge Functions, custom-role
passwords, other platform schemas/extension installation and file payloads are
outside this capture. Include any required state in the provider restore plan.

The source remained live. This is preliminary backup readiness evidence, not
the final fenced snapshot, measured RPO/RTO or proof of provider shutdown.
The later restore used a separate compatible Supabase target with reviewed
Auth/storage handling and preserved managed schema definitions; the full
managed-schema archive was not blindly replayed over the hosted project.

## Next prerequisites

The operator subsequently selected the existing timesheet-test project through
MIGRATION_DESTINATION settings for Supabase recovery, keeping Docker native as
the primary destination. Exact project name, source distinction, database TLS
and Auth access passed before authorized application-data cleanup. Its initial
22-table empty state was then superseded by the acknowledged restore. All 57
selected tables / 2,238 rows match, as do 25 function definitions/permissions,
sequence counters and Auth API identity membership. Managed schema definitions
and provider histories were preserved; application history now matches 71 rows.
See [recovery result](C00_TIMESHEET_TEST_RECOVERY.md).

This supersedes the proposed new recovery project's provisioning/billing gate.
No new project, payment, upgrade or credential extraction ran. Previous retries
and approval-review rejection remain historical evidence. Password login,
platform settings/encryption roots, off-host retention/access and measured live
RPO/RTO remain unverified. Capture-time evidence is retained without rewriting
its historical restoreVerified=false observation.

The selected .env.local has no native SMTP_HOST, SMTP_FROM or APP_BASE_URL
configuration, nor explicit source/target application URLs. No SMTP credential
authentication or email send ran. Deployed native enrollment remains unverified.

This checkout declares application 1.1.6, while the operator accepts 1.0.3.
Later Vercel inventory verifies production 1.0.3 and development 1.1.2, both
Supabase, with exact deployed source version matches. The accepted release
matches production; a native application/release and same-release parity remain
unverified. Running app/database binding also remains open. Do not label an
export from the CLI default alone or broaden admission based on the dirty checkout.
See [deployment inventory](C00_VERCEL_DEPLOYMENT_INVENTORY.md).
[Configuration/release evidence](../../evidence/c00-enrollment-release-readiness-2026-10-03.json).
Writer controls, client/session proof and measured C08 rehearsal remain open.
