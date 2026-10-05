# D2 — Timesheet list sort index

## Decision required

Support the canonical all-scope list ordering with an additive index on both backends.
Local migration execution was resumed at the user's request on 2026-10-04.
The operator subsequently reported that the migration was pushed to production.
Local verification is complete; production deployment is therefore recorded as
operator-confirmed, while production planner/runtime verification remains open.

## Verified evidence and constraints

- FACT: `lib/db/native/timesheets.ts` orders the canonical list by
  `log_date DESC, created_at DESC, id DESC`; the Supabase adapter uses the same order.
- FACT: Existing user/date and project/date indexes have leading scope columns;
  neither supplies the global three-column order.
- FACT: `db/migrate-runner.mjs` applies each new migration in a transaction.
- Preserve native SQL scope, Supabase RLS, public contracts and applied migrations.
- UNKNOWN: production query plans, post-deployment latency, relation size and
  index-build duration. Production deployment itself is operator-reported.

## Alternatives and selected protocol

Use a nonunique B-tree on all three descending sort keys. A two-key index leaves
equal-date/timestamp groups requiring an additional sort. Do not drop existing
scope indexes. Ordinary CREATE INDEX fits the transactional native runner;
CONCURRENTLY cannot run inside that transaction.

## Lifecycle, risks and acceptance

Index creation can block writes while building; schedule deployment for the
actual table size. Transaction failure rolls back creation and the ledger update.
The runner serializes migration execution and records checksums. No provider,
credential, write-gate or application lifecycle behavior changes.

Verify identical backend DDL, migration version uniqueness and existing migration
security guards. Optional TEST_DATABASE_URL verification uses an isolated temporary
table to check SQL execution, index eligibility, stable tie ordering and repeat
execution. Production planner selection and latency remain unmeasured.

## Local verification update

On 2026-10-04 root created a separate tmpfs PostgreSQL 16 test container,
applied the native schema and ran both index tests successfully. A 5,000-row
synthetic admin list with profile/project joins used the existing log-date
index plus Incremental Sort before D2, and `idx_timesheets_logdate_created`
without a sort after D2. The comparison ran inside a rolled-back transaction.
No production or migration-source/destination state was touched by that local
verification. Production planner/latency proof remains open; production
deployment is recorded separately below from the operator report.

### Local-only resume evidence

- Disposable native PostgreSQL: ledger checksum for
  `0038_timesheet_list_sort_index.sql` is
  `eb90344b22953a1a994df3a6760a628ac71875642df199a6c25a16f7cd078885`, exactly
  matching the file SHA-256; `idx_timesheets_logdate_created` is present with
  `(log_date DESC, created_at DESC, id DESC)`.
- `npm run db:migrate` against that disposable database reported `No pending
  migrations.`; `tests/timesheet-sort-index.test.ts` passed both tests with
  `TEST_DATABASE_URL` set to the disposable database.
- The local Supabase stack was one migration behind. `supabase migration up
  --local` applied only `20261006000000_timesheet_list_sort_index.sql`.
- No remote Supabase project, migration source/destination database, or
  production environment was contacted.

### Production deployment update

- On 2026-10-04 the operator reported that the D2 migration was pushed to
  production.
- This repository session has not independently verified the production
  migration ledger, `pg_indexes`, `EXPLAIN`, index build duration, or latency.
- Treat deployment as operator-confirmed and production planner/runtime evidence
  as pending until direct production verification is captured.
