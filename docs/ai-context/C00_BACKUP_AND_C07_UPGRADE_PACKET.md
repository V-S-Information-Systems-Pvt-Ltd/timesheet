# Native backup and upgrade readiness — 2026-10-03

## Decision and authorization

Continue the requested remaining migration items with local native readiness
proof. Back up the fresh C00 native destination, protect the archive for the
current Windows user, restore into a new disposable database and compare its
public rows and schema metadata. Run the existing supported-schema upgrade test
in another unique disposable database. This uses established tooling; it changes
no architecture or runtime source and transfers no hosted source data.

## Evidence and constraints

- C00 destination: `vsis_migration_destination_20261003` in
  `vsis-migration-native`, loopback 5432. The 37-migration baseline contains
  seeded references/settings but no users or timesheets in recorded evidence.
- `tools/migration/tests/migration-upgrade-path.int.test.ts` materializes the
  supported baseline `3964600` and HEAD migration bytes, adds only new workspace
  migrations, preserves fixture rows/receipt, and verifies five additive
  migrations plus idempotent rerun. Its fixture name must match
  `vsis_migration_upgrade_*`; setup drops that name, so verify nonexistence first.
- Existing canonical migration files and checksums remain unchanged. The C00
  destination is never an upgrade-test or restore target.
- Hosted recovery project creation remains authorized, with the organization
  selected, but billing policy selection is pending. No hosted writes run here.

## Lifecycle and safety

Use unique, previously absent names for both fixtures. Assert running container
and loopback binding; use credentials in memory without printing or storing
plaintext connection material. Refuse if the destination unexpectedly contains
users, sessions, reset tokens or business entries. Export via the container's
PostgreSQL 16 `pg_dump` in custom format, with no owner/ACL capture. Keep raw bytes
in memory; persist only DPAPI-protected bytes in a new task-specific temporary
directory. Decrypt that file for restore, verify its raw SHA-256, then restore
using `pg_restore --exit-on-error --no-owner --no-acl` into the new fixture.

Compare counts and sorted row digests for every public base table, plus public
column/constraint/index/function/trigger metadata and migration ledger. Recheck
the original destination after the operations. This demonstrates a baseline
logical backup only: omitted owners/ACLs/cluster roles and provider Auth/storage
need separate inventory, protection and restore proof. DPAPI recovery requires
the same Windows user/profile; this is not an off-host recovery strategy.

Clean up only the fixtures whose prior nonexistence and creation are recorded.
Retain the encrypted baseline archive and record its path, size and digest. On
test failure, capture the relevant diagnostics; do not mutate existing datasets.
Avoid concurrent operator work on the target. The supported upgrade test owns
its temporary filesystem directory and database teardown.

## Acceptance and limits

Record backup/decryption/restore success, equality checks, fixture cleanup and
the exact upgrade test outcome. Local baseline timings do not establish the
60-minute production freeze, growth-margin capacity, RPO/RTO, C08 rehearsal,
C07 live client/session matrix or original-provider recovery. Those gates remain
open. No migration transfer, provider shutdown or cutover follows automatically.
