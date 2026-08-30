-- db/migrations/0017_bound_leave_reminder_text.sql
-- Mirror the supabase text-length constraints for parity (see
-- supabase/migrations/20260904000000_bound_leave_reminder_text.sql).
--
-- Native mode validates these bounds in its REST routes
-- (leaveRowsSchema / reminderSchema), but the database is the authoritative
-- boundary; enforcing here keeps both backends identical and protects any
-- future caller that reaches the repository directly.
--
-- NOT VALID: applies to all new INSERTs/UPDATEs immediately without scanning
-- existing rows.

alter table public.leaves
  drop constraint if exists leaves_reason_max_len;
alter table public.leaves
  add constraint leaves_reason_max_len check (char_length(reason) <= 500) not valid;

alter table public.reminders
  drop constraint if exists reminders_message_max_len;
alter table public.reminders
  add constraint reminders_message_max_len check (char_length(message) <= 500) not valid;
