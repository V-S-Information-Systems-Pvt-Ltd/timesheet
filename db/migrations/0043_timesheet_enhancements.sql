-- db/migrations/0043_timesheet_enhancements.sql
-- 1. Customer on Support · Customers (ticket) entries.
-- 2. Project/Internal activities become data in activity_types (entry_type +
--    code) instead of a hard-coded CHECK list. Legacy activity types keep
--    entry_type = null. Support activities are seeded for referential
--    integrity but stay fixed in the application.
-- 3. Test users, visible only to the super admin.

-- 1. Customer ---------------------------------------------------------------
alter table public.timesheets add column if not exists customer text;

-- 2. Activity catalogue -----------------------------------------------------
alter table public.activity_types
  add column if not exists entry_type text,
  add column if not exists code text;

alter table public.activity_types drop constraint if exists activity_types_entry_type_valid;
alter table public.activity_types
  add constraint activity_types_entry_type_valid check (
    (entry_type is null and code is null)
    or (entry_type in ('project', 'support', 'internal') and code ~ '^[a-z0-9_]{1,50}$')
  );

-- The same display name may now exist once per type (e.g. "R&D" for legacy,
-- Project and Internal).
alter table public.activity_types drop constraint if exists activity_types_name_key;
create unique index if not exists activity_types_scope_name_key
  on public.activity_types (coalesce(entry_type, ''), name);
alter table public.activity_types drop constraint if exists activity_types_entry_code_key;
alter table public.activity_types
  add constraint activity_types_entry_code_key unique (entry_type, code);

create or replace function public.seed_classification_activities()
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.activity_types (entry_type, code, name) values
    ('project', 'planning', 'Planning'),
    ('project', 'implementation', 'Implementation'),
    ('project', 'testing', 'Testing'),
    ('project', 'research_development', 'R&D'),
    ('support', 'internal_it', 'Internal IT'),
    ('support', 'customers', 'Customers'),
    ('internal', 'research_development', 'R&D'),
    ('internal', 'meetings', 'Meetings'),
    ('internal', 'certifications', 'Certifications'),
    ('internal', 'poc', 'POC'),
    ('internal', 'presales_support', 'Presales Support'),
    ('internal', 'other', 'Other')
  on conflict do nothing;
$$;

select public.seed_classification_activities();

-- New-format rows reference the catalogue; legacy rows (null entry_type) are
-- not checked (MATCH SIMPLE).
alter table public.timesheets drop constraint if exists timesheets_activity_catalogue_fk;
alter table public.timesheets
  add constraint timesheets_activity_catalogue_fk
  foreign key (entry_type, activity_code)
  references public.activity_types (entry_type, code);

-- Same branch rules as 0039, minus the Project/Internal code lists (now
-- enforced by the FK above), plus the customer column.
alter table public.timesheets drop constraint if exists timesheets_classification_valid;
alter table public.timesheets
  add constraint timesheets_classification_valid check ((
    case
      when entry_type is null then
        project_id is not null
        and activity_code is null
        and ticket_number is null
        and activity_other is null
        and customer is null
      when entry_type = 'project' then
        activity_type_id is null
        and project_id is not null
        and activity_code is not null
        and ticket_number is null
        and activity_other is null
        and customer is null
      when entry_type = 'support' then
        activity_type_id is null
        and project_id is null
        and activity_other is null
        and (
          (activity_code = 'customers' and ticket_number is not null
            and ticket_number = btrim(ticket_number, E' \t\n\r\f\013                 　﻿')
            and char_length(ticket_number) between 1 and 100
            and (customer is null or char_length(customer) between 1 and 200))
          or (activity_code = 'internal_it' and ticket_number is null and customer is null)
        )
      when entry_type = 'internal' then
        activity_type_id is null
        and project_id is null
        and ticket_number is null
        and customer is null
        and activity_code is not null
        and (
          (activity_code = 'other' and activity_other is not null
            and activity_other = btrim(activity_other, E' \t\n\r\f\013                 　﻿')
            and char_length(activity_other) between 1 and 200)
          or (activity_code <> 'other' and activity_other is null)
        )
      else false
    end
  ) is true);

-- 3. Test users -------------------------------------------------------------
alter table public.profiles
  add column if not exists is_test_user boolean not null default false;
