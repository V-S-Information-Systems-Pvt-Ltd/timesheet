-- 20260902000000_restrict_totals_rpc.sql
-- Phase 4.3 remediation: get_timesheet_daily_totals returns EVERY user's
-- daily hour totals. Creating it with `security definer` and granting it to
-- `authenticated` let any signed-in user read all users' hours directly
-- through the Supabase client (RLS does not apply inside a security-definer
-- function). The native adapter gates the same data behind an admin check.
--
-- Restrict the function to the service role: only the server-side admin path
-- (app/actions/import-backup.ts -> repo.getTimesheetDailyTotals) may call it.
-- A direct `rpc('get_timesheet_daily_totals')` from an `authenticated` client
-- now fails with "permission denied for function".
revoke all on function public.get_timesheet_daily_totals() from public, anon, authenticated;
grant execute on function public.get_timesheet_daily_totals() to service_role;