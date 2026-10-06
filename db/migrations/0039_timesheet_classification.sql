-- db/migrations/0039_timesheet_classification.sql
-- Timesheet classification v2 (Type -> Activity) for the native backend.
-- Additive and backward compatible: historical rows (entry_type is null) are
-- never rewritten and keep the legacy Project + Activity-type shape.
--
-- Paired with supabase/migrations/20261007000000_timesheet_classification.sql. The classification
-- CHECK constraint and the projects eligibility flag/trigger are byte-identical
-- across both backends.

-- 1. Nullable classification/detail columns on timesheets.
alter table public.timesheets
  add column if not exists entry_type text,
  add column if not exists activity_code text,
  add column if not exists activity_other text,
  add column if not exists ticket_number text;

-- 2. New-format Support/Internal entries have no project; legacy rows keep one.
alter table public.timesheets alter column project_id drop not null;

-- 3. Enforce valid new-format combinations without rejecting legacy rows.
alter table public.timesheets drop constraint if exists timesheets_classification_valid;
alter table public.timesheets
  add constraint timesheets_classification_valid check ((
    case
      when entry_type is null then
        project_id is not null
        and activity_code is null
        and ticket_number is null
        and activity_other is null
      when entry_type = 'project' then
        activity_type_id is null
        and project_id is not null
        and activity_code in ('planning', 'implementation', 'testing', 'research_development')
        and ticket_number is null
        and activity_other is null
      when entry_type = 'support' then
        activity_type_id is null
        and project_id is null
        and activity_other is null
        and (
          (activity_code = 'customers' and ticket_number is not null
            and ticket_number = btrim(ticket_number, E' \t\n\r\f\013\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')
            and char_length(ticket_number) between 1 and 100)
          or (activity_code = 'internal_it' and ticket_number is null)
        )
      when entry_type = 'internal' then
        activity_type_id is null
        and project_id is null
        and ticket_number is null
        and activity_code in ('research_development', 'meetings', 'certifications', 'poc', 'presales_support', 'other')
        and (
          (activity_code = 'other' and activity_other is not null
            and activity_other = btrim(activity_other, E' \t\n\r\f\013\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')
            and char_length(activity_other) between 1 and 200)
          or (activity_code <> 'other' and activity_other is null)
        )
      else false
    end
  ) is true);

-- 4. Project eligibility flag for the new-format Project picker.
alter table public.projects
  add column if not exists is_timesheet_project boolean not null default true;

-- 5. Mark existing reserved reference rows ineligible (trimmed, case-insensitive).
update public.projects
   set is_timesheet_project = false
 where lower(btrim(name, E' \t\n\r\f\013\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) in ('internal', 'internal it', 'support');

-- 6. Reject eligible reserved projects; trusted seed/restore may supply false.
--    Renames never rewrite eligibility.
create or replace function public.projects_reserved_timesheet_flag()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.is_timesheet_project and lower(btrim(new.name, E' \t\n\r\f\013\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) in ('internal', 'internal it', 'support') then
    raise exception 'Reserved project names are only allowed for historical reference data.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_reserved_timesheet_flag on public.projects;
create trigger projects_reserved_timesheet_flag
  before insert or update on public.projects
  for each row execute function public.projects_reserved_timesheet_flag();

-- 7. Extend the canonical effect fingerprint for new-format timesheet writes.
--    The legacy branch (entry_type is null) is byte-identical to the prior
--    definition so every historical retry still matches; a legacy row's extra
--    null columns fall through the null branch and fingerprint exactly as before.
create or replace function public.idempotency_effect_fingerprint(p_operation text, p_payload jsonb)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized jsonb;
  payload_rows jsonb;
  canon text;
begin
  if p_operation = 'create_leave' then
    if p_payload is null or jsonb_typeof(p_payload) not in ('array', 'object') then
      raise exception 'Invalid create_leave payload.' using errcode = '22023';
    end if;
    payload_rows := case
      when jsonb_typeof(p_payload) = 'object' then jsonb_build_array(p_payload)
      else p_payload
    end;
    select jsonb_agg(
             jsonb_build_object(
               'user_id', e ->> 'user_id',
               'leave_date', (e ->> 'leave_date')::date,
               'reason', e ->> 'reason'
             )
             order by e ->> 'user_id', e ->> 'leave_date', coalesce(e ->> 'reason', '')
           )
      into normalized
      from jsonb_array_elements(payload_rows) as e;
    normalized := coalesce(normalized, '[]'::jsonb);
    canon := normalized::text;
  else
    normalized := case p_operation
      when 'create_timesheet' then case when (p_payload ->> 'entry_type') is null then jsonb_build_object(
        'user_id', p_payload ->> 'user_id',
        'project_id', p_payload ->> 'project_id',
        'activity_type_id', p_payload -> 'activity_type_id',
        'hours_worked', round((p_payload ->> 'hours_worked')::numeric, 2),
        'work_done', p_payload ->> 'work_done',
        'log_date', (p_payload ->> 'log_date')::date
      )
      else jsonb_build_object(
        'user_id', p_payload ->> 'user_id',
        'project_id', p_payload -> 'project_id',
        'activity_type_id', p_payload -> 'activity_type_id',
        'entry_type', p_payload ->> 'entry_type',
        'activity_code', p_payload ->> 'activity_code',
        'activity_other', nullif(btrim(p_payload ->> 'activity_other', E' \t\n\r\f\013\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'), ''),
        'ticket_number', nullif(btrim(p_payload ->> 'ticket_number', E' \t\n\r\f\013\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'), ''),
        'hours_worked', round((p_payload ->> 'hours_worked')::numeric, 2),
        'work_done', p_payload ->> 'work_done',
        'log_date', (p_payload ->> 'log_date')::date
      ) end
      when 'update_timesheet' then case when (p_payload ->> 'entry_type') is null then jsonb_build_object(
        'id', p_payload ->> 'id',
        'project_id', p_payload ->> 'project_id',
        'activity_type_id', p_payload -> 'activity_type_id',
        'hours_worked', round((p_payload ->> 'hours_worked')::numeric, 2),
        'work_done', p_payload ->> 'work_done',
        'log_date', (p_payload ->> 'log_date')::date
      )
      else jsonb_build_object(
        'id', p_payload ->> 'id',
        'project_id', p_payload -> 'project_id',
        'activity_type_id', p_payload -> 'activity_type_id',
        'entry_type', p_payload ->> 'entry_type',
        'activity_code', p_payload ->> 'activity_code',
        'activity_other', nullif(btrim(p_payload ->> 'activity_other', E' \t\n\r\f\013\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'), ''),
        'ticket_number', nullif(btrim(p_payload ->> 'ticket_number', E' \t\n\r\f\013\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'), ''),
        'hours_worked', round((p_payload ->> 'hours_worked')::numeric, 2),
        'work_done', p_payload ->> 'work_done',
        'log_date', (p_payload ->> 'log_date')::date
      ) end
      when 'delete_timesheet' then jsonb_build_object('id', p_payload ->> 'id')
      when 'delete_leave' then jsonb_build_object('id', p_payload ->> 'id')
      when 'create_reminder' then jsonb_build_object(
        'user_id', p_payload ->> 'user_id',
        'message', p_payload ->> 'message',
        'remind_at', to_char(
          (p_payload ->> 'remind_at')::timestamptz at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
      )
      when 'update_reminder' then jsonb_build_object(
        'id', p_payload ->> 'id',
        'done', (p_payload ->> 'done')::boolean
      )
      when 'delete_reminder' then jsonb_build_object('id', p_payload ->> 'id')
      else null
    end;

    if normalized is null then
      raise exception 'Unsupported idempotency operation: %', p_operation using errcode = '22023';
    end if;

    select string_agg(k || '=' || (normalized -> k)::text, E'\n' order by k)
      into canon
      from jsonb_object_keys(normalized) as k;
  end if;

  return encode(public.digest(convert_to(coalesce(canon, ''), 'UTF8'), 'sha256'), 'hex');
end;
$$;
