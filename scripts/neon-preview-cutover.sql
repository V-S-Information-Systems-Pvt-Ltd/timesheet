-- scripts/neon-preview-cutover.sql
-- One-off data cutover for the Neon `preview` branch (not a migration: it must
-- not run automatically on other databases).
--
-- 1. Retire every timesheet dated before 2026-10-01 into public.timesheets_archive.
-- 2. Convert legacy (entry_type is null) rows from 2026-10-01 onward whose
--    Project + Activity type maps to exactly one classification-v2 shape.
--    Ambiguous rows are left untouched and listed by the report query at the end.
-- 3. Every converted row's original values are kept in
--    public.timesheet_format_conversions so the conversion can be reversed.
--
-- Run as a single transaction; the guards raise and roll back on any mismatch.

begin;

-- 1. Retire pre-October records ------------------------------------------------
create table if not exists public.timesheets_archive (
  like public.timesheets including defaults including constraints,
  archived_at timestamptz not null default now(),
  archive_reason text not null,
  primary key (id)
);

do $$
declare
  to_move int;
  moved int;
begin
  select count(*) into to_move from public.timesheets where log_date < date '2026-10-01';

  insert into public.timesheets_archive
    (id, user_id, project_id, log_date, hours_worked, work_done, created_at,
     activity_type_id, entry_type, activity_code, activity_other, ticket_number,
     archive_reason)
  select id, user_id, project_id, log_date, hours_worked, work_done, created_at,
         activity_type_id, entry_type, activity_code, activity_other, ticket_number,
         'retired: dated before 2026-10-01'
  from public.timesheets
  where log_date < date '2026-10-01';
  get diagnostics moved = row_count;

  if moved <> to_move then
    raise exception 'archive copy mismatch: expected %, copied %', to_move, moved;
  end if;

  delete from public.timesheets t
  using public.timesheets_archive a
  where a.id = t.id and t.log_date < date '2026-10-01';
  get diagnostics moved = row_count;

  if moved <> to_move then
    raise exception 'archive delete mismatch: expected %, deleted %', to_move, moved;
  end if;
  raise notice 'retired % timesheets', moved;
end $$;

-- 2. Convert unambiguous legacy rows -------------------------------------------
create table if not exists public.timesheet_format_conversions (
  timesheet_id uuid primary key,
  old_project_id uuid not null,
  old_activity_type_id uuid,
  new_entry_type text not null,
  new_activity_code text not null,
  converted_at timestamptz not null default now()
);

-- Deterministic mapping: legacy activity type name x whether the project is a
-- real timesheet project. Support and Implementation-on-Internal are excluded
-- on purpose: v2 needs facts (customer ticket vs internal IT, free-text
-- "other") that the legacy row does not record.
create temporary table cutover_map (
  activity_name text not null,
  is_timesheet_project boolean not null,
  entry_type text not null,
  activity_code text not null
) on commit drop;

insert into cutover_map values
  ('Certification',    false, 'internal', 'certifications'),
  ('Meeting',          false, 'internal', 'meetings'),
  ('R&D',              false, 'internal', 'research_development'),
  ('POC',              false, 'internal', 'poc'),
  ('Presales support', false, 'internal', 'presales_support'),
  ('Implementation',   true,  'project',  'implementation'),
  ('R&D',              true,  'project',  'research_development');

with candidates as (
  select t.id, t.project_id, t.activity_type_id, m.entry_type, m.activity_code
  from public.timesheets t
  join public.projects p on p.id = t.project_id
  join public.activity_types a on a.id = t.activity_type_id
  join cutover_map m
    on m.activity_name = a.name and m.is_timesheet_project = p.is_timesheet_project
  where t.entry_type is null and t.log_date >= date '2026-10-01'
)
insert into public.timesheet_format_conversions
  (timesheet_id, old_project_id, old_activity_type_id, new_entry_type, new_activity_code)
select id, project_id, activity_type_id, entry_type, activity_code from candidates;

update public.timesheets t
set entry_type = c.new_entry_type,
    activity_code = c.new_activity_code,
    activity_type_id = null,
    project_id = case when c.new_entry_type = 'project' then t.project_id end
from public.timesheet_format_conversions c
where c.timesheet_id = t.id and t.entry_type is null;

commit;

-- Undo step 2 (manual):
--   update public.timesheets t set entry_type = null, activity_code = null,
--     project_id = c.old_project_id, activity_type_id = c.old_activity_type_id
--   from public.timesheet_format_conversions c where c.timesheet_id = t.id;
-- Undo step 1 (manual):
--   insert into public.timesheets select id, user_id, project_id, log_date, hours_worked,
--     work_done, created_at, activity_type_id, entry_type, activity_code, activity_other,
--     ticket_number from public.timesheets_archive;
