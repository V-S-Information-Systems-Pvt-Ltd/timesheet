# Supabase -> native password migration

Supabase bcrypt hashes are imported unchanged into `profiles.password_hash`;
the app verifies them with bcryptjs and upgrades to scrypt on next login
(web and mobile both go through `signIn`).

Steps:
1. Run the existing data migration first so `profiles` rows exist (same ids as `auth.users`).
2. `psql "$SUPABASE_DB_URL" -f 01-export-from-supabase.sql` -> `supabase_auth_users.csv`.
3. `psql "$DATABASE_URL" -f 02-import-into-native.sql` and check the printed counts.
4. Delete `supabase_auth_users.csv` (and any copies).

Notes:
- The CSV contains password hashes: treat it as a secret; never commit it.
- Existing `password_hash` values are never overwritten; rerunning is safe.
- Users still without a hash afterwards (OAuth / magic-link, or no profile
  match) must use the password reset flow.
- bcrypt cost above 14 is rejected at login (DoS bound).
