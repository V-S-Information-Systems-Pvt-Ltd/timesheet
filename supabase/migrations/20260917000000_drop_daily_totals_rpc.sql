-- supabase/migrations/20260917000000_drop_daily_totals_rpc.sql
-- Contract the obsolete unscoped daily-totals aggregate (T18.1).
--
-- All callers moved to the scoped `sumHoursForUserDates` primitive
-- (see app/actions/import-backup.ts); nothing in the app calls
-- `repo.getTimesheetDailyTotals` anymore. The unfiltered GROUP BY over all
-- timesheets (and its service_role read of every user's hours) is removed.
-- Kept as a separate migration after the move (not an edit of
-- 20260901000000/20260902000000) so rollback stays compatible: reverting app
-- code that still references the RPC must re-create it first.

drop function if exists public.get_timesheet_daily_totals();
