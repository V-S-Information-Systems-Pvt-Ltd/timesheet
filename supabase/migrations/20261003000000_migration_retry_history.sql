-- Portable retry evidence imported with a migration bundle. Server-only;
-- runtime reads use the service role and exact actor/key/operation predicates.

create table if not exists public.migration_retry_history (
  source_namespace text not null,
  key text not null,
  source_actor_id text not null,
  destination_actor_id uuid,
  operation text not null check (operation in (
    'create_timesheet', 'update_timesheet', 'delete_timesheet',
    'create_leave', 'delete_leave',
    'create_reminder', 'update_reminder', 'delete_reminder'
  )),
  outcome text not null check (outcome in ('committed', 'uncertain')),
  response_status integer not null,
  fingerprint_kind text not null check (fingerprint_kind in ('request-json-v1', 'effect-v1')),
  fingerprint text,
  source_resource_id text,
  destination_resource_id text,
  created_at timestamptz not null,
  run_id text not null references public.migration_runs(run_id) deferrable initially deferred,
  primary key (source_namespace, key, source_actor_id, operation),
  constraint migration_retry_history_coherent check (
    (outcome = 'committed' and response_status > 0 and fingerprint ~ '^[0-9a-f]{64}$')
    or (outcome = 'uncertain' and response_status = 0)
  )
);

create index if not exists migration_retry_history_lookup_idx
  on public.migration_retry_history (destination_actor_id, key, operation);

alter table public.migration_retry_history enable row level security;
revoke all on table public.migration_retry_history from public, anon, authenticated;
grant select on table public.migration_retry_history to service_role;

