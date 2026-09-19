-- 0033_migration_write_gate.sql
-- C06B: the durable destination write gate.
--
-- The gate is a single row that records whether business writers are admitted.
-- It is the mechanism behind the C06A publication policy: while a migration is
-- in its final planning/apply/verification window the destination is fenced,
-- and the merged destination is admitted only after its publication gates pass.
-- A maintenance page is not a fence; a durable row that every write path obeys
-- is. Only the migration tooling and the operator running it may change it.

create table if not exists public.migration_write_gate (
  id boolean primary key default true,
  state text not null check (state in ('open', 'fenced')),
  run_id text,
  reason text,
  updated_at timestamptz not null default now(),
  updated_by text not null,
  constraint migration_write_gate_single_row check (id)
);

comment on table public.migration_write_gate is
  'C06B write gate: state=open admits business writes, state=fenced refuses them. Single row by construction.';

insert into public.migration_write_gate (id, state, reason, updated_by)
values (true, 'open', 'initial state: writers are admitted', 'bootstrap')
on conflict (id) do nothing;
