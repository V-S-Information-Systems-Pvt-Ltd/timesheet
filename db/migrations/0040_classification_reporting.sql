-- Classification-aware aggregates; legacy rows remain untouched.
-- Native reads use equivalent actor-scoped SQL; this invoker function also
-- provides the same grouping contract for trusted database tooling.
create or replace function public.get_grouped_report_totals(
  p_group_by text,
  p_project_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_entry_type text default null,
  p_activity_code text default null
)
returns table (label text, hours double precision, entries bigint)
language sql stable parallel safe
security invoker
set search_path = public
as $$
  select
    case
      when p_group_by = 'type' then coalesce(c.type_label, 'Legacy')
      when p_group_by = 'project' then case
        when t.entry_type in ('support', 'internal') then c.type_label || ' — no project'
        else coalesce(p.name, 'Unknown project') end
      when p_group_by = 'activity' then case
        when t.entry_type is null then 'Legacy · ' || coalesce(at.name, '(no type)')
        else c.type_label || ' · ' || c.activity_label end
      else coalesce(pr.email, 'Unknown')
    end as label,
    coalesce(sum(t.hours_worked), 0)::double precision as hours,
    count(*) as entries
  from public.timesheets t
  left join public.projects p on p.id = t.project_id
  left join public.activity_types at on at.id = t.activity_type_id
  left join public.profiles pr on pr.id = t.user_id
  cross join lateral (select
    case t.entry_type when 'project' then 'Project' when 'support' then 'Support' when 'internal' then 'Internal' end as type_label,
    case t.activity_code
      when 'planning' then 'Planning' when 'implementation' then 'Implementation'
      when 'testing' then 'Testing' when 'research_development' then 'R&D'
      when 'internal_it' then 'Internal IT' when 'customers' then 'Customers'
      when 'meetings' then 'Meetings' when 'certifications' then 'Certifications'
      when 'poc' then 'POC' when 'presales_support' then 'Presales Support'
      when 'other' then 'Other' end as activity_label
  ) c
  where (p_project_id is null or t.project_id = p_project_id)
    and (p_from is null or t.log_date >= p_from)
    and (p_to is null or t.log_date <= p_to)
    and (p_entry_type is null or (p_entry_type = 'legacy' and t.entry_type is null) or t.entry_type = p_entry_type)
    and (p_activity_code is null or t.activity_code = p_activity_code)
  group by label
  order by hours desc;
$$;
revoke all on function public.get_grouped_report_totals(text, uuid, date, date, text, text) from public;
