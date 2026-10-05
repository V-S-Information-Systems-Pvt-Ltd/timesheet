# C00 protected hosted-source backup — 2026-10-03

## Decision and authorization

Continue the authorized migration prerequisites with a read-only source backup.
Use only MIGRATION_SOURCE_DB from Git-ignored .env.local, validate its selected
project binding in memory, and never print any setting value or raw error.
No source DDL/DML, provider fence, live restore or cutover is needed.

## Verified boundaries

- Source is the selected Supabase deployment, with working Session pooler access.
  Existing source inspection/Auth binding, ledger and source schema checks pass.
- The available Docker image public.ecr.aws/supabase/postgres:17.6.1.167 provides
  PostgreSQL 17 clients. Verify source/client major compatibility before dumping.
- scripts/backup-supabase.mjs establishes outside-repository backup placement,
  Windows private-folder ACLs and withheld CLI diagnostics. Reuse its permission
  helper. Its six separate CLI dumps do not share a snapshot; this operation uses
  one custom archive across public, auth, storage and supabase_migrations.
- A custom archive is a capture/reference artifact, not a script to blindly
  restore over Supabase-managed objects. Original-provider restore remains gated
  on a compatible unused Supabase destination and reviewed provider workflow.

## Lifecycle and safety

Create a uniquely named private directory outside the repository. Pass database
credentials to a temporary Docker client's stdin, not tool text or process argv.
Use a fixed shell consumer that reads libpq values, enables read-only defaults,
timeouts and verified TLS, then execs pg_dump. Use the existing image; no image
pull or persistent database/container is needed. Suppress all incidental output.

Keep archive bytes in memory; persist only Windows DPAPI CurrentUser protected
bytes. Capture protected role metadata without password hashes separately if
available. Owners and ACLs stay in the archive. Decrypt the persisted bytes back
into memory, compare SHA-256 and parse the pg_restore TOC privately to confirm
expected schemas, Auth tables, migration history and legacy field metadata.
Never print record bodies, connection strings, certificate details or raw errors.
Clean up only newly created scratch/temporary artifacts; retain protected backup.

## Acceptance and remaining limits

Report exact capture scope, sizes/digests, encryption/decryption verification,
source/client majors and archive inventory checks. Do not call it restore proof:
TOC validation is not a provider restore or Auth/login test. Role passwords,
platform settings, API/JWT/Vault encryption secrets and object file payloads need
separate operator retention/recovery decisions. DPAPI requires the same Windows
account/profile; local storage is not off-host retention.

The source remains live. This is a preliminary consistent database-data capture,
not the final fenced migration snapshot or RPO/RTO measurement. Storage payload
and full provider recovery must be checked separately. Recovery creation billing
selection, deployed writer controls and C07 client/session proof remain open.

## Authorization and TLS update

Automatic approval review initially rejected the broad Auth/data capture and
local retention as insufficiently explicit. The operator then explicitly
approved the encrypted source backup. This approval covers the prepared scope
and private encrypted temporary-folder retention; it does not authorize restore,
source writes or project billing.

System trust alone rejected the database TLS chain. Supabase's official
dashboard source (apps/studio/hooks/custom-content/custom-content.json) specifies
the production CA at
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt.
Download over verified HTTPS, validate CA/self-signature/validity, pass it to each
temporary client and use verify-full. Keep host/container trust stores unchanged;
never retry by disabling certificate or hostname checks.

## Observed outcome

Capture completed: 556,426 raw archive bytes; only 556,646 protected bytes were
persisted. Owners/ACLs and the selected four schemas are included. Protected role
metadata has 31 roles and 25 memberships with no password hashes. Decrypt/readback
digests and archive inventory pass. Source/client majors are 17; verified client
TLS with the official CA passes. The explicit SQL probe is read-only; the pooler
does not preserve the startup read-only option, and its internal database hop's
pg_stat_ssl value is distinct from client TLS. Retain pg_dump's read-only snapshot
semantics and client verify-full rather than weakening either check.

Temporary named clients were removed. Protected files remain in the private
directory recorded by evidence. No provider restore, source write or email ran.
Role metadata is outside the shared data snapshot. Off-host retention and full
provider restore remain open. Evidence:
[capture](../../evidence/c00-protected-source-backup-2026-10-03.json).
