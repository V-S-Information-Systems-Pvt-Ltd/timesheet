-- Portable retry evidence imported with a migration bundle. This table is
-- operational state: application clients never write it, and it is exported
-- only through the normalized retry-history artifact.

create extension if not exists pgcrypto;

create table if not exists public.migration_retry_history (
  source_namespace text not null,
  key text not null,
  source_actor_id text not null,
  destination_actor_id uuid,
  operation text not null check (operation in (
    'create_timesheet', 'update_timesheet', 'delete_timesheet',
    'create_leave', 'delete_leave',
    'create_reminder', 'update_reminder', 'delete_reminder'
  )),
  outcome text not null check (outcome in ('committed', 'uncertain')),
  response_status integer not null,
  fingerprint_kind text not null check (fingerprint_kind in ('request-json-v1', 'effect-v1')),
  fingerprint text,
  source_resource_id text,
  destination_resource_id text,
  created_at timestamptz not null,
  run_id text not null references public.migration_runs(run_id) deferrable initially deferred,
  primary key (source_namespace, key, source_actor_id, operation),
  constraint migration_retry_history_coherent check (
    (outcome = 'committed' and response_status > 0 and fingerprint ~ '^[0-9a-f]{64}$')
    or (outcome = 'uncertain' and response_status = 0)
  )
);

create index if not exists migration_retry_history_lookup_idx
  on public.migration_retry_history (destination_actor_id, key, operation);

-- Native needs the same canonical effect fingerprint as Supabase so imported
-- Supabase effects can be checked after reverse ID mapping.
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
    payload_rows := case when jsonb_typeof(p_payload) = 'object' then jsonb_build_array(p_payload) else p_payload end;
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
    canon := coalesce(normalized, '[]'::jsonb)::text;
  else
    normalized := case p_operation
      when 'create_timesheet' then jsonb_build_object(
        'user_id', p_payload ->> 'user_id', 'project_id', p_payload ->> 'project_id',
        'activity_type_id', p_payload -> 'activity_type_id',
        'hours_worked', round((p_payload ->> 'hours_worked')::numeric, 2),
        'work_done', p_payload ->> 'work_done', 'log_date', (p_payload ->> 'log_date')::date)
      when 'update_timesheet' then jsonb_build_object(
        'id', p_payload ->> 'id', 'project_id', p_payload ->> 'project_id',
        'activity_type_id', p_payload -> 'activity_type_id',
        'hours_worked', round((p_payload ->> 'hours_worked')::numeric, 2),
        'work_done', p_payload ->> 'work_done', 'log_date', (p_payload ->> 'log_date')::date)
      when 'delete_timesheet' then jsonb_build_object('id', p_payload ->> 'id')
      when 'delete_leave' then jsonb_build_object('id', p_payload ->> 'id')
      when 'create_reminder' then jsonb_build_object(
        'user_id', p_payload ->> 'user_id', 'message', p_payload ->> 'message',
        'remind_at', to_char((p_payload ->> 'remind_at')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      when 'update_reminder' then jsonb_build_object('id', p_payload ->> 'id', 'done', (p_payload ->> 'done')::boolean)
      when 'delete_reminder' then jsonb_build_object('id', p_payload ->> 'id')
      else null
    end;
    if normalized is null then
      raise exception 'Unsupported idempotency operation: %', p_operation using errcode = '22023';
    end if;
    select string_agg(k || '=' || (normalized -> k)::text, E'\n' order by k)
      into canon from jsonb_object_keys(normalized) as k;
  end if;
  return encode(public.digest(convert_to(coalesce(canon, ''), 'UTF8'), 'sha256'), 'hex');
end;
$$;

