# Native backup and upgrade readiness — 2026-10-03

> Archived 2026-10-04 as supporting reference. Recorded evidence, contracts and
> unverified limitations retain their scope; this move marks no pending check complete.
> Current work follows the [active plans](../../../docs/README.md#active).

## Completed local checks

The fresh C00 destination `vsis_migration_destination_20261003` was read without
changing its data, gate, or migration ledger. A PostgreSQL custom archive was
created with owners and ACLs omitted, protected with Windows DPAPI CurrentUser,
read back from its encrypted file, decrypted and digest-verified, then restored
into a new disposable database.

All **24 public tables** matched by exact row counts and sorted row digests.
Public columns, constraints, indexes, functions, triggers, policies and row
security metadata matched. The original destination's same snapshot matched
again after the operations. The baseline contains reference/settings data and
37 applied migrations, with no application users or timesheets; it is not a
backup of the hosted source or a populated merged destination.

| Evidence | Result |
| --- | --- |
| Raw archive | 63,466 bytes; SHA-256 `30e859cfceab777fdb87d1212bcade7735e8978ab717166eb2afaef363583d3a` |
| Protected archive | 63,686 bytes; SHA-256 `97dbb675edd1949c466aa4267333bc9dfaac87805f559fc8cc529bdefc6621b4` |
| Decryption | Raw SHA-256 matched before restore |
| Restore | All public rows and inspected schema metadata matched |
| Supported upgrade | Existing integration test passed 1/1 from baseline `3964600646edc92002efb85a55781c76abf23751` |
| Upgrade invariants | Representative project/profile rows and old receipt preserved; five additive migrations installed; gate/bootstrap surfaces usable; repeat migration run applied nothing |
| Fixture cleanup | Both newly named restore/upgrade databases absent afterward |

The encrypted archive is retained at
`C:\Users\kasku\AppData\Local\Temp\vsis-native-backup-1791036145878_aca9f6\native-baseline.dpapi`.
No raw dump or connection secret was written to repository evidence. Recovery
uses this Windows account/profile; this is not an off-host backup strategy.
Temporary-directory retention is not guaranteed. Owners, ACLs and cluster roles
were deliberately omitted and require separate capture/restore proof. The
restore check does not establish source Auth, storage, password recovery or
SMTP enrollment readiness.

Measured local operation times were approximately 1.149 seconds for dump plus
protection and 0.761 seconds for restore plus verification. These small baseline
timings do not establish the 60-minute production freeze, 120-minute RPO,
720-minute RTO or a representative C08 volume rehearsal. No transfer occurred.

## Source backup availability and capacity observations

Authenticated CLI `backups list --project-ref bcsdqkjzobllocejfcdz` returned
`walg_enabled: true`, `pitr_enabled: false`, an empty physical backup list and
empty physical backup metadata. This establishes no listed provider snapshot or
PITR recovery point at the observation time; it does not establish whether the
operator has a separate manually protected backup. No source restore had run at
that observation; the later logical recovery result is recorded below.

Docker reports 16,292,470,784 bytes of memory and 32 CPUs. The native container
has no explicit memory or CPU limit, so those resources are shared with other
containers. Its PostgreSQL volume filesystem reports 978,240,992 available
1024-byte blocks; Docker virtual-disk capacity is not physical host headroom.
Windows C: reports 92,828,729,344 free bytes. Actual free resources and peak
dump/apply/restore demand must be measured under representative workload before
capacity or freeze budgets pass.

## Evidence and remaining prerequisites

- [Backup, restore, upgrade and cleanup results](../../evidence/native-backup-upgrade-2026-10-03.json)
- [Provider backup metadata and capacity snapshot](../../evidence/c00-backup-capacity-2026-10-03.json)
- [Private source connection checks](../../evidence/c00-source-inspect-2026-10-03.json)
- [Decision and lifecycle packet](../decisions/C00_BACKUP_AND_C07_UPGRADE_PACKET.md)

This supplies native baseline backup and upgrade mechanism evidence. C00 still
requires account/platform recovery proof, off-host retention/access
decisions, capacity proof and full
writer controls. The existing Supabase target is now prepared as recorded below.
C07 still requires the deployment/client/session/remapping matrix; the general
Windows Computer Use work item is separately completed by user confirmation.
C06B remains partial and C08 has not started. The proposed hosted recovery
creation is superseded by the operator-selected existing timesheet-test project.
Identity/access checks, authorized data cleanup and the later scoped source
restore pass. See [recovery result](C00_TIMESHEET_TEST_RECOVERY.md).
All three explicit source migration settings
are present in the Git-ignored `.env.local`. After the operator supplied the
Session pooler URI, read-only CLI inspection and API-to-database account binding
passed. Required migration ledger entries are present, no canonical tables are
missing, and canonical column compatibility checks report no issues.

The earlier IPv6 network blocker is resolved. Source schema support now passes
with narrowly registered source-only variants for an extra nullable
`profiles.full_name` column and nullable `profiles.is_active`,
`projects.created_at`, `timesheets.work_done` and `timesheets.created_at`.
All four latter columns have zero null rows at this observation, while the legacy
name column has one populated row, which exactly matches profiles.name (zero
divergent rows). Current application code uses name, and the existing export
assertLegacyProfileData guard rejects independent legacy values. No separate
name would be omitted at this snapshot; that guard remains under the export
snapshot. Destination admission stays strict, unknown drift is rejected and
required-value checks still reject null data. No fingerprint was normalized or
bypassed. The operator authorized skipping the field and planning retirement;
see the [retirement plan](../../../docs/plans/PROFILE_FULL_NAME_RETIREMENT_PLAN.md).
Live read-only revalidation passed under the new source policy;
[evidence](../../evidence/c00-source-compatibility-2026-10-03.json) supersedes the
earlier unsupported result without erasing that observation.

The latest canonical count is 1,011 rows, including 854 timesheets. Maximum
observed PostgreSQL JSON row sizes are 1,267 bytes across these entities and
462 bytes for app_settings; these are live SQL serialization observations, not
measured bundle sizes or representative peak resource demand. No URI, address,
credential, setting value or Auth account body was printed or saved in evidence.
No source data/schema change, transfer or TLS-validation bypass occurred.

## Later protected source capture

After explicit operator approval, a private DPAPI-protected archive captured
public/Auth/storage/migration-history schemas and data with owners and ACLs.
Protected role metadata was captured separately without password hashes. Both
encrypted files decrypted and matched their raw SHA-256; archive inventory checks
passed. Verified client TLS used the official Supabase CA with verify-full.
No source write ran. See [source backup readiness](C00_PROTECTED_SOURCE_BACKUP.md)
for paths, scope and remaining original-provider recovery/retention limits.

The selected local file lacks native SMTP/base-URL settings and explicit
application deployment URLs. The later operator-provided Vercel URLs are recorded
in [deployment inventory](C00_VERCEL_DEPLOYMENT_INVENTORY.md): production 1.0.3,
development 1.1.2, both Supabase, matching exact commit versions. The accepted
operator release matches production; dirty checkout 1.1.6 is not deployed.
The local C07 harness now resolves the native application/database binding:
production commit 0cf125a249c3e00feac55337b43e7d72fbc8e95b and its locked
Next.js 16.3.8 dependency set were built in native mode after one test-only
route-module compatibility edit that removes the export modifier from a
file-local forgot-password response constant. The running harness reports app
1.0.3 / backend native, returns 200 from health/config, and connects from the
application side to Docker database vsis_migration_destination_20261003 with all
37 migrations. An authenticated browser session proved reads remain 200 while a
fenced write returns 503 WRITERS_FENCED; reopening the gate restored ordinary
validation behavior. Teardown removed the test profile and left the gate open.
See [C07 native binding evidence](../../evidence/c07-native-app-binding-2026-10-03.json).

Database binding and the native 1.0.3 runtime path are therefore evidenced. A
byte-for-byte pristine 1.0.3 native build/deployment, native SMTP/enrollment and
provider-wide shutdown/drain proof remain open before measured C08 work.

## Later Supabase logical recovery verification

The encrypted source archive was restored into verified timesheet-test after
schema/permission review, a successful rollback rehearsal and fresh state
reconciliation. Commit was acknowledged. An independent consistent snapshot
matched every selected table: **57 tables / 2,238 rows**, all 25 function
definitions/owners/execute grants, sequence counters and Auth API identity
membership. The target has 23 RLS-enabled public tables, 68 policies, nine enabled
public user triggers, 71 application history rows and 23 Auth users/identities.
Managed schema definitions and provider migration histories were preserved.

This closes the selected logical source-restore check. Password login/enrollment,
platform configuration/encryption roots, storage payload recovery and durable/
off-host retention remain unverified. Earlier failed rollback sequence updates
are documented; final rollback tests skipped them and committed counters matched.
The archive was captured while the source was live; this is not final fenced
recovery, production RPO/RTO, capacity or C08 proof. No native transfer occurred.
See [restore result and evidence](C00_SUPABASE_SOURCE_RESTORE.md).
