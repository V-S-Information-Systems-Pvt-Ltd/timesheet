-- supabase/migrations/20260822000000_perf_indexes.sql
-- Composite index for the most common dashboard/report filter.
create index if not exists idx_timesheets_user_date
  on public.timesheets (user_id, log_date desc);
