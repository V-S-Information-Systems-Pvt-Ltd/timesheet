-- db/migrations/0026_idempotency_keys.sql
-- Offline replay deduplication store with 90-day retention support.

create table if not exists public.idempotency_keys (
  key text not null,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operation text not null,
  payload_fingerprint text not null,
  response_status integer not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key, actor_id, operation)
);

create index if not exists idx_idempotency_keys_created_at on public.idempotency_keys(created_at);
