-- Durable reviewed source-record dispositions for migration receipts.
-- Operational migration evidence: ordinary application roles cannot read or
-- mutate it; migration tooling uses the service role.

create table if not exists public.migration_record_dispositions (
  run_id text not null,
  source_namespace text not null,
  entity text not null,
  source_id text not null,
  action text not null check (action in ('create', 'update', 'map', 'exclude')),
  destination_id text,
  reason text,
  recorded_at timestamptz not null default now(),
  primary key (run_id, entity, source_id),
  constraint migration_record_dispositions_run_fk
    foreign key (run_id) references public.migration_runs(run_id)
    deferrable initially deferred,
  constraint migration_record_dispositions_shape check (
    (action = 'exclude' and destination_id is null and nullif(btrim(reason), '') is not null)
    or
    (action <> 'exclude' and destination_id is not null and reason is null)
  )
);

create index if not exists migration_record_dispositions_source_idx
  on public.migration_record_dispositions (source_namespace, entity, source_id);

alter table public.migration_record_dispositions enable row level security;
revoke all on table public.migration_record_dispositions from public, anon, authenticated;
