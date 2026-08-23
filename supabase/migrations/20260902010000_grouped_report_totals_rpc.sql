-- 20260902010000_grouped_report_totals_rpc.sql
-- Phase 4.5: server-side GROUP BY aggregation for reports, replacing the
-- client-side (JS) row-scan in app/api/data/reports/route.ts.
--
-- Security model (see IMPLEMENTATION_PLAN §4.3):
--   * SECURITY INVOKER — the function body runs with the calling user's
--     privileges, so Row Level Security on public.timesheets scopes the rows
--     exactly as it does for the normal read path: managers see their team,
--     regular users only their own.
--   * Granted to `authenticated` (and `service_role`), NOT to `public`/`anon`.
--   * No SECURITY DEFINER, so RLS can never be bypassed for this read.
create or replace function public.get_grouped_report_totals(
  p_group_by text,
  p_project_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  label text,
  hours double precision,
  entries bigint
)
language sql
stable
parallel safe
set search_path = public
as $$
  select
    case
      when p_group_by = 'project' then coalesce(p.name, 'Unknown project')
      when p_group_by = 'activity' then coalesce(at.name, '(no type)')
      else coalesce(pr.email, 'Unknown')
    end as label,
    coalesce(sum(t.hours_worked), 0) as hours,
    count(*) as entries
  from public.timesheets t
  left join public.projects p on p.id = t.project_id
  left join public.activity_types at on at.id = t.activity_type_id
  left join public.profiles pr on pr.id = t.user_id
  where (p_project_id is null or t.project_id = p_project_id)
    and (p_from is null or t.log_date >= p_from)
    and (p_to is null or t.log_date <= p_to)
  group by label
  order by hours desc;
$$;

revoke all on function public.get_grouped_report_totals(text, uuid, date, date) from public, anon;
grant execute on function public.get_grouped_report_totals(text, uuid, date, date) to authenticated, service_role;