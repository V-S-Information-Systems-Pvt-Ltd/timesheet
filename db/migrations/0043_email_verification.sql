-- db/migrations/0043_email_verification.sql
-- Self-signup must prove ownership of the email address before the account can
-- be activated. Without this, anyone could register an active account under an
-- unowned address at an auto-activate domain (the Supabase backend relied on
-- GoTrue's email confirmation, which the native backend dropped).
--
-- Existing profiles and admin-created/seeded accounts are treated as verified
-- through the column default; only self-signup inserts an explicit null.
-- Raw verification tokens are never persisted; only their SHA-256 digests.

alter table public.profiles
  add column if not exists email_verified_at timestamptz default now();

create table if not exists public.email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at)
);

create index if not exists email_verification_tokens_user_idx
  on public.email_verification_tokens (user_id, used_at);

create index if not exists email_verification_tokens_expiry_idx
  on public.email_verification_tokens (expires_at);
