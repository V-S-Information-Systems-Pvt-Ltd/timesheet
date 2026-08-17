-- supabase/migrations/20260818000000_multi_entries.sql
-- Allow multiple timesheet entries per user per day. The daily total is
-- capped at 24 hours in the application layer (server actions + import).
--
-- Drops the (user_id, log_date) unique index that previously enforced one
-- entry per day. Idempotent.

drop index if exists timesheets_user_date_key;