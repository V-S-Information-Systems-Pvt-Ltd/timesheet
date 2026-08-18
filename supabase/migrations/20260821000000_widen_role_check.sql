-- Widen profiles.role CHECK to admit the manager / team_lead hierarchy roles.
--
-- 20260819000000 added these roles to the application, but the original
-- column-level CHECK (role in ('admin','pm','co','user')) already existed on
-- live databases by the time that migration ran there, and versioned
-- migrations are never edited once applied. This follow-up is idempotent:
-- it recreates the constraint with the widened list whether or not the live
-- database already picked it up.
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'pm', 'co', 'manager', 'team_lead', 'user'));