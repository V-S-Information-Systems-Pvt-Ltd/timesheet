-- Support the canonical all-scope list order, including its stable ID tie-breaker.
-- Keep the native and Supabase index definitions identical.
create index if not exists idx_timesheets_logdate_created
  on public.timesheets (log_date desc, created_at desc, id desc);
