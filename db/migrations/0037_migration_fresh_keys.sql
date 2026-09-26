-- Server-minted admission keys for post-cutover, reference-free mobile work.
-- This is destination-local operational state, never portable business data.
create table if not exists public.migration_fresh_keys (
  key text primary key,
  actor_id uuid not null,
  operation text not null check (operation in ('create_reminder', 'create_leave')),
  fence_generation uuid not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint migration_fresh_keys_expiry check (expires_at > issued_at)
);

create index if not exists migration_fresh_keys_actor_expiry_idx
  on public.migration_fresh_keys (actor_id, expires_at);
