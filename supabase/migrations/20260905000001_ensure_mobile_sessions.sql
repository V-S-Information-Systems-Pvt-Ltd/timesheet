-- Idempotent table-only bridge ensuring public.mobile_sessions exists
-- before dependent migrations in all database lineages.
-- Contains no function definitions (rotation is owned by post-head pin migration).

create table if not exists public.mobile_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  family_id uuid not null,
  refresh_token_hash text not null unique,
  previous_token_hash text unique,
  device_name text not null default '',
  platform text not null default 'unknown',
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz,
  replaced_by_id uuid references public.mobile_sessions (id) on delete set null,
  check (idle_expires_at <= absolute_expires_at)
);

create index if not exists mobile_sessions_user_active_idx
  on public.mobile_sessions (user_id, revoked_at, absolute_expires_at);
create index if not exists mobile_sessions_family_idx
  on public.mobile_sessions (family_id, revoked_at);

alter table public.mobile_sessions enable row level security;
revoke all on table public.mobile_sessions from public, anon, authenticated;
