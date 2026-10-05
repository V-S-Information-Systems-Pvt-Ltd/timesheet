# C00 existing Supabase recovery target — 2026-10-03

## Decision and authorization

Use the explicitly supplied MIGRATION_DESTINATION settings for the existing
Supabase recovery target. The operator authorizes dropping its data only after
the project name is verified as exactly timesheet-test, and confirms that Docker
native remains the primary migration destination. This replaces the proposed
new hosted recovery project; no project creation, payment or upgrade is needed.

## Verified evidence and boundary

- FACT: connections.ts resolves only explicitly named MIGRATION_ settings and
  binds Auth/DB project identities; settings and raw diagnostics stay private.
- FACT: authenticated CLI metadata matches the configured database project to
  timesheet-test, in the source organization, ACTIVE_HEALTHY and distinct from
  both the named live source and the configured source connection.
- FACT: verified TLS/read-only SQL confirms PostgreSQL 17, expected database and
  user (including pooler postgres.<ref> to SQL postgres mapping). The configured
  destination Auth service key succeeds against the bound provider endpoint.
- FACT: 22 public tables, 21 public functions, 68 public policies; zero Auth users,
  identities, buckets or storage objects. A private schema and migration history
  are present; neither is assumed empty or safe to drop based on this probe.
- UNKNOWN: current public/private row counts, outside-schema FK dependencies,
  truncate triggers, full managed-schema/archive compatibility, platform secrets
  and deployment writer control. Inventory before any cleanup or restoration.

## Lifecycle / alternatives

Prefer an explicit transaction clearing the complete public table set with
TRUNCATE RESTRICT, preserving schema definitions and managed provider objects.
Do not issue DROP DATABASE, DROP managed schemas, CASCADE or apply an unreviewed
full source archive. Revalidate project name immediately before mutation; refuse
source/target equality or changed configuration. If Auth/storage gains rows or
unexpected truncate triggers exist, stop and revise the bounded operation.

Record exact row counts and schema/table metadata, then hold transaction locks
for cleanup and its verification. On SQL/permission/dependency failure, roll back
the transaction. A lost commit response requires read-only reconciliation before
any retry. Do not blindly repeat destructive work. Successful point-in-time
emptiness is not deployment fencing or a guaranteed absence of future writers.

Inspect private tables and provider migration history; keep them outside the
public cleanup unless restore preparation establishes why changes are needed.
Original-provider restore must separately reconcile source/destination managed
schemas and custom Auth triggers/policies; DPAPI readback alone remains insufficient.

## Acceptance and remaining gates

Before cleanup: project name/source distinction, verified database/Auth binding,
exact scoped counts and bounded SQL. After cleanup: all public rows zero, same
public table/function/policy counts, Auth/storage still empty, migration history
and private state unchanged; native/source untouched. Record secret-free evidence.
No portable transfer, provider cutover, C08 rehearsal or live retirement occurs.
Full source recovery, retention, release/enrollment and writer/client gates stay open.

## Observed outcome

Pre-cleanup inventory found 58 public baseline rows, no truncate triggers or
outside-public foreign keys, no private ordinary tables, and 69 migration-history
rows. Exact name and all connection/Auth checks passed again before the mutation.
Transactional cleanup committed and a separate fresh read-only connection
verified zero public rows, unchanged 22-table/21-function/68-policy counts, empty
managed data and unchanged history. Restore has not run; no runtime code changed.
See [target preparation and evidence](../archive/C00_TIMESHEET_TEST_RECOVERY.md).
