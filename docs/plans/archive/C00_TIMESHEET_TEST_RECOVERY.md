# Existing Supabase recovery target — 2026-10-03

> Archived 2026-10-04 as supporting reference. Recorded evidence, contracts and
> unverified limitations retain their scope; this move marks no pending check complete.
> Current work follows the [active plans](../../README.md#active).

Status: **TARGET VERIFIED; LOGICAL SOURCE RESTORE VERIFIED.** Password login,
platform recovery and durable/off-host backup retention remain unverified.

The operator selected the MIGRATION_DESTINATION settings from Git-ignored
.env.local for Supabase recovery and explicitly authorized discarding data only
after verifying that the project name is exactly timesheet-test. The operator
also confirmed Docker native remains the primary migration destination.

## Target checks and committed cleanup

Authenticated CLI metadata matched the configured database project to the exact
name timesheet-test, in the source organization and ACTIVE_HEALTHY. Its project
identity is distinct from both the selected live source and the configured source
connection. No setting, URL, credential, address or record body was printed.

The database is PostgreSQL 17. Verified client TLS and a read-only transaction
confirmed the expected database and SQL user; the pooler username mapping was
checked explicitly. MIGRATION_DESTINATION_AUTH_SERVICE_KEY works with the bound
Auth endpoint. No new project, payment, plan change or credential-store access ran.

Before restore, the complete 22-table public set had **58 rows**: 45 projects, five activities,
six titles, app_settings and the migration gate singleton. A fresh identity and
read-only inspection preceded the cleanup. A single transaction locked the
public tables and used TRUNCATE RESTART IDENTITY RESTRICT; no CASCADE or schema
drop ran. No truncate triggers or outside-public foreign keys were found.
The commit response was acknowledged.

A separate new connection verified the cleanup at that stage:

- all 22 public tables have zero rows;
- the same 22 tables, 21 functions and 68 policies remain;
- Auth users/identities and storage buckets/objects remain empty, including an
  independent Auth API read;
- all 69 Supabase application migration-history rows remain unchanged;
- the private schema had no ordinary tables and remains outside cleanup scope.

The live source and all Docker native databases were outside the write operation.
The original native destination remains vsis_migration_destination_20261003.
This target is reserved for recovery. The later source restore below supersedes
that empty state. Point-in-time emptiness did not prove deployment fencing or
prevent future writers.

## Committed source restore and independent verification

The approved DPAPI archive decrypted with matching hashes. Archive/target
inspection verified managed COPY columns, required roles/extensions and the
existing Auth hook before mutation. A successful rollback rehearsal preceded
a fresh state reconciliation and the committing restore; commit was acknowledged.

All **57 selected tables / 2,238 rows** matched the archive inside the transaction
and again through a new consistent target snapshot after commit. All **25 public
and private function definitions, owners and execute grants** matched; captured
sequence counters matched. Auth API identity membership also matched privately.
The restored target has 23 public tables with RLS, 68 policies, nine enabled
public user triggers, 71 application migration-history rows, 23 Auth users and
23 identities. Profile/Auth ID gaps and normalized email mismatches are zero.

Managed schema definitions and provider migration histories were preserved.
Only reviewed application objects/data and compatible managed table data were
restored; no CASCADE, schema drop, managed trigger drop or role escalation ran.
Four private function bodies were recovered from captured application migration
history and matched live source bodies, with hardened search paths and exact
source privileges. The existing Auth trigger/function OID was preserved; its
application-owned hook was transiently suppressed and restored within the
transaction. Public USER triggers were enabled again before commit.

An earlier failed rollback rehearsal reached nontransactional sequence setval;
its target counter may have advanced despite row/schema rollback. Subsequent
rollback tests skipped counters; the final commit applied captured counters last
and independent verification confirmed them. Source counters were not changed.

The legacy full_name value remains in this recovery copy and equals name.
Portable transfer still omits it under its equality guard; retirement remains
a plan. This restore is scoped logical recovery, not a portable migration or
full platform/account-usability proof. See [restore result](C00_SUPABASE_SOURCE_RESTORE.md).

## Configuration and remaining work

MIGRATION_DESTINATION_DB now selects the hosted recovery database for this work.
Pass provider supabase for these operations. Never pass this setting to the
native destination adapter based on the old role assignment; native migration
work needs a separately explicit native connection variable. .env.local was not
edited by the agent, and no fallback to application credentials is permitted.

The prepared timesheet-recovery-20261003 creation request is superseded. Its
Free-plan/slot confirmation is no longer a prerequisite to provisioning this
already existing selected target. No new hosted resources or billing were created.

Selected source data/schema restore verification now passes. Account usability, durable/off-host
retention, native enrollment, deployed release policy and writer/client/session
proof remain open. C00 is partial; C08 has not started and C09/C10 authorization
is unchanged. No live source write, portable transfer, cutover or retirement ran.

## Evidence

- [Read-only identity and pre-cleanup inventory](../evidence/c00-timesheet-test-recovery-inspection-2026-10-03.json)
- [Committed cleanup and exact before/after counts](../evidence/c00-timesheet-test-recovery-cleanup-2026-10-03.json)
- [Independent post-commit verification](../evidence/c00-timesheet-test-recovery-verification-2026-10-03.json)
- [Archive and compatibility review](../evidence/c00-supabase-restore-archive-plan-2026-10-03.json)
- [Successful rollback rehearsal](../evidence/c00-supabase-restore-dry-run-2026-10-03.json)
- [Acknowledged source restore](../evidence/c00-supabase-source-restore-2026-10-03.json)
- [Independent source restore verification](../evidence/c00-supabase-source-restore-verification-2026-10-03.json)
- [Decision and lifecycle packet](../../ai-context/C00_TIMESHEET_TEST_RECOVERY_PACKET.md)
- [Protected source backup](C00_PROTECTED_SOURCE_BACKUP.md)
