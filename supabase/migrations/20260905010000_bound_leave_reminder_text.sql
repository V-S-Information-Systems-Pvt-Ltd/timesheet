-- supabase/migrations/20260904000000_bound_leave_reminder_text.sql
-- Enforce the input bounds at the database that the native backend enforces
-- at its REST boundary.
--
-- In supabase mode the browser writes leaves and personal reminders directly
-- through PostgREST (lib/data/client.ts); the only server-side gate is RLS,
-- which checks ownership (auth.uid() = user_id) but nothing else. The native
-- REST routes validate reason <= 500 chars and message <= 500 chars
-- (lib/validation-schemas.ts leaveRowsSchema / reminderSchema), so any
-- authenticated user holding the public anon key could previously persist
-- unbounded-length text into their own rows.
--
-- NOT VALID: the constraint applies to all new INSERTs/UPDATEs immediately,
-- while existing rows (which may exceed the bound via the previously
-- unvalidated path) are left untouched. Run `VALIDATE CONSTRAINT` manually
-- once existing data is confirmed clean.

alter table public.leaves
  drop constraint if exists leaves_reason_max_len;
alter table public.leaves
  add constraint leaves_reason_max_len check (char_length(reason) <= 500) not valid;

alter table public.reminders
  drop constraint if exists reminders_message_max_len;
alter table public.reminders
  add constraint reminders_message_max_len check (char_length(message) <= 500) not valid;
