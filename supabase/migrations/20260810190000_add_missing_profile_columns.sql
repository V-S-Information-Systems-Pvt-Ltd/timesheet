-- Add columns missing from the manually-created profiles table.
--
-- Without an email column, the handle_new_user trigger fails on every
-- auth.users insert, so sign-up / OTP / admin user creation all return
-- "500: Database error saving new user".

alter table public.profiles
  add column if not exists email text,
  add column if not exists created_at timestamptz not null default now();

-- Backfill email from auth.users; fall back to a unique placeholder for any
-- orphan rows so the not-null/unique constraints can be applied.
update public.profiles p
set email = coalesce(u.email, 'orphan-' || p.id || '@invalid.local')
from auth.users u
where u.id = p.id;

update public.profiles
set email = 'orphan-' || id || '@invalid.local'
where email is null;

alter table public.profiles
  alter column email set not null,
  add constraint profiles_email_key unique (email);
