# C00 protected-source restore in timesheet-test — 2026-10-03

## Decision and authorization

Continue source-backup recovery verification using the operator-selected existing
timesheet-test project and MIGRATION_DESTINATION settings. The operator permits
discarding its data after exact project-name verification, confirms its recovery
role (Docker native remains primary), and requests continued work after target
preparation. Preserve the source and all native databases. No emails, cutover,
provider billing, source fence or source retirement is part of this test.

## Verified source and constraints

- FACT: protected-source evidence records one PG17 custom archive for public,
  auth, storage and supabase_migrations, with owners/ACLs. DPAPI readback digests
  passed. Archive/root secrets/private schema/Storage payloads are separate scopes.
- FACT: target identity/access and cleanup evidence verifies exact timesheet-test
  name, source distinction, TLS/Auth/database binding and zero public rows; 22
  public tables and 69 history rows remain. Both providers use PG17.
- FACT: official provider restore guidance preserves managed schemas, treats
  custom Auth/storage triggers/policies separately, and warns about encryption
  roots/roles. A blind full-archive restore is not a supported safe operation.
- FACT: tools/migration/src/connections.ts resolves explicit MIGRATION_ inputs
  and binds Auth/database identifiers. No application credential fallback is used.
- UNKNOWN: archive public function owners/role dependencies, managed-column
  compatibility, custom trigger/policy dependencies, extension/encryption state,
  destination jobs/writers and account usability. Resolve before mutation.

## Alternatives and selected protocol

Do not overwrite managed schemas or blindly replay role metadata. Inspect the
decrypted archive only in process memory, parse its TOC/schema/data privately,
and compare managed tables/columns and referenced roles/extensions. Capture no
additional raw source records. Prefer reviewed application schema restoration,
managed table data restoration and custom Auth/storage objects only, retaining
provider-managed migration history and platform object ownership.

Refuse restore if identity/configuration changes, nonempty target business/Auth/
Storage data reappears, unreviewed schema dependencies exist, required roles or
extensions are absent, managed columns are incompatible, or populated encrypted
state requires a missing root. Validate all selected SQL and its hash privately.

Restore in one transaction with ON_ERROR_STOP, bounded locks/timeouts and
transaction-local trigger suppression for data import. Recreate reviewed
application schema/custom objects; preserve managed schemas. Revalidate restored
table counts/digests, history, legacy field, constraints, owners/ACLs and required
customizations. Roll back on failure. A lost commit reply requires read-only
reconciliation; never blindly retry. No partial-success claim or automatic source
change is allowed. Keep exact temporary-client ownership and remove owned scripts.

## Acceptance and remaining limits

Record archive integrity, identity, selected/excluded scope, exact row counts and
per-table digest matches, provider custom-object/permission checks and Auth API
read verification without credentials/record bodies. Login/enrollment, platform
configuration, crypto roots, Storage payloads, durable/off-host retention and live
RPO/RTO/fencing remain separate evidence. This is not C08 portable rehearsal or
C09/C10 authorization. Stop at a concrete missing input, not a guessed PASS.

## Consolidated permission invariant after rollback test

The first transactional rehearsal was rejected by PostgreSQL permissions and
rolled back. Independent reads confirm the original 22 empty public tables,
69 history rows, empty Auth/storage and original four private function hashes.
The configured role cannot own auth.users or set session_replication_role;
it can insert Auth users. Do not grant roles, impersonate managed owners or
disable provider protections. The planned generic trigger-suppression protocol
above is superseded for this destination by the bounded protocol below.

Preserve the existing managed Auth trigger: its definition matches the source.
Preserve its public.handle_new_user function OID with CREATE OR REPLACE, never
drop that function. Within the restore transaction only, make that application-
owned hook a no-op while copying backed-up Auth users, then restore its exact
archived body/configuration/owner/ACL before validation and commit. Disable only
USER triggers on postgres-owned public tables while copying; restore all source
trigger states afterward. Keep managed/internal constraint triggers enabled.

Topologically order COPY operations using destination FK metadata, including
managed Auth dependencies, plus source FK metadata for restored application
tables absent from the old target. Ignore same-table edges because each COPY is one
statement. Refuse cross-table cycles or references absent from the selected data
surface. Restore backed-up sequence counters only with verified UPDATE rights.
No managed schema/trigger DDL or session_replication_role change is permitted.

The existing archive history recovers all four private function bodies exactly.
Source bodies match those statements; pin their current hardened empty search
path, postgres owner and explicit original execute grants. Preserve public
namespace/default permissions, which match source and destination already.
Before commit, require every selected table count/digest, all 25 function
definitions/permissions, the original Auth hook and public trigger states.
Use a rollback rehearsal first and revalidate unchanged target state afterward.

COPY verification must use PostgreSQL output semantics: inet_out preserves COPY's
address representation, while inet::text adds a full-width mask. Use UTF-8 byte
ordering for per-table row digests, explicit timezone/bytea/session formatting,
and COPY text escaping. Never display address or token field contents.

Sequence setval is not transactional. Exclude counters from further rollback
rehearsals; validate UPDATE permission beforehand and apply captured counters
only at the end of the committing operation after all other checks. An earlier
failed rehearsal reached setval before its hash check; its target counter may
have advanced despite row/schema rollback. Target data was explicitly disposable;
rows/history/function rollback was reconciled, and no source counter changed.
Do not describe these rehearsals as preserving every target sequence value.

Restore each function's exact execute-grant set (including grantor/options),
owner, SECURITY DEFINER flag and search path. Compare aclexplode rows in a fixed
order, not raw ACL array storage order or NULL-vs-default representation. Reject
unknown grant roles or grantors; normalize only postgres/PUBLIC/anon/authenticated/
service_role privileges already present in the source. Validate grants inside the
transaction before commit; post-response-only ACL checks cannot enforce rollback.

## Observed completion and limits

The settled rollback rehearsal passed all 57 selected table count/hash checks
and all 25 function definition/owner/execute-grant checks. A separate read-only
reconciliation confirmed original empty target rows/history/function state
before the committing operation. Captured counters were applied only at the
end of that commit, which was acknowledged.

Fresh post-commit consistent data extraction and SQL/Auth reads independently
matched all **57 tables / 2,238 rows**, function definitions/privileges, captured
counters and Auth API identity membership. Public RLS tables/policies/triggers
are 23/68/9, with no disabled user trigger. Application history has 71 rows,
Auth users/identities 23/23, and profile/Auth gaps/email mismatches zero.

FACT: scoped logical recovery passes; capture-time restoreVerified=false remains
historical evidence. UNKNOWN: password login/enrollment, full platform settings/
encryption-root recovery, storage payload recovery, off-host retention, production
RPO/RTO and complete writer/client fencing. C08 has not started. No source write,
portable transfer, billing change, cutover or retirement ran.
See [result and finding ledger](../plans/archive/C00_SUPABASE_SOURCE_RESTORE.md) and
[independent verification](../plans/evidence/c00-supabase-source-restore-verification-2026-10-03.json).
