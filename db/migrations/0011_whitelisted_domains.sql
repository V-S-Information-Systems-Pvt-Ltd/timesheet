-- db/migrations/0011_whitelisted_domains.sql
-- Email domain whitelist for self-registration with auto-activation option.

create table if not exists public.whitelisted_domains (
  id text primary key default gen_random_uuid()::text,
  domain text not null unique,
  auto_activate boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_whitelisted_domains_domain on public.whitelisted_domains (domain);
