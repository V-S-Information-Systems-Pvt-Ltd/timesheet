-- supabase/migrations/20261001000000_migration_write_gate.sql
-- C06B: the durable destination write gate (Supabase track).
--
-- Readable by signed-in callers so every write path can obey it, writable by
-- nobody but the service role: ordinary users must not be able to open or close
-- the gate. The migration tooling connects with the service role.

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

alter table public.migration_write_gate enable row level security;

-- Nobody but the service role may change the gate. No insert/update/delete
-- policies exist, and the write privileges are revoked explicitly (the exact
-- form the mobile-session guard suite requires of every later RLS table) so the
-- intent does not depend on default grants.
revoke all on table public.migration_write_gate from public, anon, authenticated;
grant select on public.migration_write_gate to authenticated;

drop policy if exists migration_write_gate_read on public.migration_write_gate;
create policy migration_write_gate_read on public.migration_write_gate
  for select to authenticated using (true);
