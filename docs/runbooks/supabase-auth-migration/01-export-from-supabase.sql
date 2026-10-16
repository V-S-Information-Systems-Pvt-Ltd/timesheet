-- Run against the SUPABASE database:  psql "$SUPABASE_DB_URL" -f 01-export-from-supabase.sql
-- Output CSV contains password hashes: treat as a secret and delete after import.
-- Users with null/empty encrypted_password (OAuth / magic link) have no password
-- to carry over; they must use the password reset flow.
\copy (select id, lower(email) as email, encrypted_password, email_confirmed_at from auth.users where deleted_at is null) to 'supabase_auth_users.csv' csv header
