-- Run against the NATIVE database:  psql "$DATABASE_URL" -f 02-import-into-native.sql
-- Expects supabase_auth_users.csv (from 01) in the current directory.
-- Does NOT create profiles rows: profile data comes from the existing data
-- migration tool. Only profiles.password_hash is set, and never overwritten.
-- Hashes are bcrypt ($2a/$2b/$2y); the app upgrades them to scrypt on next login.
begin;
create temp table staging (
  id uuid, email text, encrypted_password text, email_confirmed_at timestamptz
) on commit drop;
\copy staging from 'supabase_auth_users.csv' csv header

with upd as (
  update public.profiles p set password_hash = s.encrypted_password
  from staging s
  where p.id = s.id and p.password_hash is null and s.encrypted_password like '$2%'
  returning p.id
)
select (select count(*) from staging) as staging_rows,
       (select count(*) from staging s join public.profiles p on p.id = s.id) as matched,
       (select count(*) from upd) as updated;

select count(*) as staging_without_profile
from staging s where not exists (select 1 from public.profiles p where p.id = s.id);

select count(*) as profiles_still_without_password_hash
from public.profiles where password_hash is null;
commit;
