-- supabase/migrations/20260930000000_migration_receipts.sql
-- Destination-local records for the backend migration tool (Supabase flavor).
--
-- Server-only: RLS is enabled and every public PostgREST role is revoked. The
-- migration CLI connects with an explicit service-role/direct connection; the
-- application never reads these tables and bundles never include their rows.

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

create table if not exists public.migration_identity_journal (
  run_id text not null,
  destination_id text not null,
  action text not null check (action in ('created', 'adopted')),
  created_at timestamptz not null default now(),
  primary key (run_id, destination_id)
);

alter table public.migration_runs enable row level security;
alter table public.migration_record_map enable row level security;
alter table public.migration_identity_journal enable row level security;

revoke all on table public.migration_runs from public, anon, authenticated;
revoke all on table public.migration_record_map from public, anon, authenticated;
revoke all on table public.migration_identity_journal from public, anon, authenticated;

create policy mobile_token_session_guard on public.migration_runs
  as restrictive for all to authenticated
  using ((select public.mobile_token_session_is_valid()))
  with check ((select public.mobile_token_session_is_valid()));

create policy mobile_token_session_guard on public.migration_record_map
  as restrictive for all to authenticated
  using ((select public.mobile_token_session_is_valid()))
  with check ((select public.mobile_token_session_is_valid()));

create policy mobile_token_session_guard on public.migration_identity_journal
  as restrictive for all to authenticated
  using ((select public.mobile_token_session_is_valid()))
  with check ((select public.mobile_token_session_is_valid()));

