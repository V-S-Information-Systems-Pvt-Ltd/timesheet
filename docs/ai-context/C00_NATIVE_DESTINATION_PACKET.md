# C00 native destination preparation — 2026-10-03

## Decision and authorization

Prepare a fresh local native destination for inventory, without importing source
data or changing existing fixture databases. After identifying the three old
Docker databases, the user authorized creating a new one. Use
`vsis_migration_destination_20261003` in the existing `vsis-migration-native`
PostgreSQL container. The user subsequently also authorized a hosted Supabase
recovery project in the source organization. CLI access is restored and billing
policy confirmation remains pending; no hosted project is created by this native
preparation step.

## Evidence and constraints

- FACT: Docker listed `vsis-migration-native` as stopped. It was started for
  inspection and contains `vsis_migration_native_test`,
  `vsis_migration_c06b_v6`, and `vsis_migration_c08_recovery`.
- FACT: PostgreSQL reports 16.15; the existing container publishes loopback 5432.
- FACT: `db/migrate-runner.mjs:runMigrations` is the shared canonical runner;
  `db/migrate.ts` and `lib/db/migrate.ts` use it. It records checksums, serializes
  runners with an advisory lock, and applies each migration transactionally.
- FACT: `tools/migration/src/cli.ts:runInspect` uses an explicit `MIGRATION_*`
  connection, probes read-only enforcement, and reports catalog/count/identity
  evidence. `preflight` needs an actual validated bundle; retirement inventory
  collects later Phase 4 evidence and cannot close C00.
- UNKNOWN: full provider controls, source/destination cross-collisions, backups,
  recovery target, SMTP/enrollment and measured capacity remain unverified.

## Alternatives and lifecycle

Choose a fresh database rather than reuse a fixture with unknown prior state.
Refuse to create if its name already exists; never drop or overwrite a database.
Read container connection settings in memory and emit no credentials. Apply only
the repository baseline through the canonical runner, without creating an
application user or importing timesheets. Inspect the new database afterward.
On failure, retain the fresh database and report the failed stage; do not retry
against an existing database without inspecting it. Keep it for subsequent
operator work; deletion would require a separately scoped cleanup.

## Acceptance

Confirm new database identity, migration ledger/checksums, complete native
catalog, zero user/business rows except migration defaults, and read-only CLI
inspection. Capture results in the migration checkpoint ledger. This preparation
does not authorize fences, publication, source correction, rehearsal, or cutover.
