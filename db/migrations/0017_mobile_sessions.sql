-- Device sessions for the versioned mobile bearer-token API.
-- Raw refresh tokens are never persisted; only their SHA-256 digests are.

create table public.mobile_sessions (
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

create index mobile_sessions_user_active_idx
  on public.mobile_sessions (user_id, revoked_at, absolute_expires_at);
create index mobile_sessions_family_idx
  on public.mobile_sessions (family_id, revoked_at);
