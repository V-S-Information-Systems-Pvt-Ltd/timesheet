-- Native password recovery tokens and per-user session invalidation.
-- Raw reset tokens are never persisted; only their SHA-256 digests are stored.

alter table public.profiles
  add column if not exists session_version integer not null default 0;

alter table public.profiles
  drop constraint if exists profiles_session_version_nonnegative;

alter table public.profiles
  add constraint profiles_session_version_nonnegative check (session_version >= 0);

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at)
);

create index if not exists password_reset_tokens_user_active_idx
  on public.password_reset_tokens (user_id, used_at, expires_at);

create index if not exists password_reset_tokens_expiry_idx
  on public.password_reset_tokens (expires_at);
