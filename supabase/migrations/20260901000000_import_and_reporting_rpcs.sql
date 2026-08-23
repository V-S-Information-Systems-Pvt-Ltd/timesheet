-- 20260901000000_import_and_reporting_rpcs.sql
-- Phase 4.3 & 4.5: Efficient grouped database primitives for imports and reports in Supabase.

-- Grouped daily totals RPC for timesheet imports (replaces client-side row-paging loop)
create or replace function public.get_timesheet_daily_totals()
returns table (
  user_id uuid,
  log_date date,
  hours numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select user_id, log_date, coalesce(sum(hours_worked), 0) as hours
  from public.timesheets
  group by user_id, log_date;
$$;

revoke all on function public.get_timesheet_daily_totals() from public, anon;
grant execute on function public.get_timesheet_daily_totals() to authenticated, service_role;
