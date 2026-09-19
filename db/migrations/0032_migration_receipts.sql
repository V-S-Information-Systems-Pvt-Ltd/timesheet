-- db/migrations/0032_migration_receipts.sql
-- Destination-local records for the backend migration tool.
--
-- These tables are operational infrastructure, not application data: the app
-- never reads or writes them, they are excluded from migration bundles, and the
-- receipt/mapping rows are written in the same transaction as the merge they
-- describe. `migration_record_map` is the verified provenance a later re-export
-- carries so a remapped record is not recreated on return.

create table if not exists public.migration_runs (
  run_id text primary key,
  bundle_id text not null,
  bundle_digest text not null,
  plan_digest text not null,
  resolution_digest text not null,
  expected_result_digest text not null,
  source_namespace text not null,
  target_namespace text not null,
  application_version text not null,
  schema_fingerprint text not null,
  state text not null check (state in ('data-committed', 'verified', 'publication-intent', 'writable', 'failed')),
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  committed_at timestamptz not null default now()
);

create table if not exists public.migration_record_map (
  source_namespace text not null,
  entity text not null,
  source_id text not null,
  destination_id text not null,
  run_id text not null,
  recorded_at timestamptz not null default now(),
  primary key (source_namespace, entity, source_id)
);

create index if not exists migration_record_map_destination_idx
  on public.migration_record_map (destination_id);

-- Identities created through the destination provider are journaled separately
-- from the app-data transaction (Auth provisioning and SQL are not one
-- transaction), so a lost API response can be reconciled and a failed merge can
-- clean up only identities proven to belong to its own run.
create table if not exists public.migration_identity_journal (
  run_id text not null,
  destination_id text not null,
  action text not null check (action in ('created', 'adopted')),
  created_at timestamptz not null default now(),
  primary key (run_id, destination_id)
);
