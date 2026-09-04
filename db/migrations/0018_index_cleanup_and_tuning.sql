-- db/migrations/0018_index_cleanup_and_tuning.sql
-- Drop redundant single-column indexes on unique columns (whitelisted_domains.domain, titles.name).
-- Add composite indexes for timesheet project/date aggregation and mobile session cleanup.

drop index if exists public.idx_whitelisted_domains_domain;
drop index if exists public.idx_titles_name;

create index if not exists idx_timesheets_project_date
  on public.timesheets (project_id, log_date desc);

create index if not exists mobile_sessions_cleanup_idx
  on public.mobile_sessions (absolute_expires_at, idle_expires_at);
