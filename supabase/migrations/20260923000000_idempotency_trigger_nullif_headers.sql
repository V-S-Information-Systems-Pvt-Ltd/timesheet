-- supabase/migrations/20260923000000_idempotency_trigger_nullif_headers.sql
-- Harden the T19.2 idempotency triggers against sessions without request
-- headers (follow-up to 20260920000000_idempotency_effects.sql).
--
-- MUST be a new file, not an edit of 20260920000000: that migration is
-- already pushed, and applied versions are never re-run, so an in-place edit
-- would silently diverge fresh bootstraps from the live project. CREATE OR
-- REPLACE preserves the existing owner, trigger bindings, and grants; only
-- the function bodies change.
--
-- Defect: an unset request.headers GUC reads back as '' (not NULL) outside
-- PostgREST, so `coalesce(current_setting(...), '{}')::jsonb` raised a JSON
-- syntax error at DECLARE time and failed EVERY write to the three tables
-- from direct-SQL writers (seeds, scripts, dashboard SQL). PostgREST always
-- sends valid JSON, so production traffic never hit this — but unkeyed
-- passthrough must hold for every writer. Fix: strip the empty string with
-- nullif before the coalesce, in both trigger functions.

-- Do not rely on a migration runner's implicit transaction behavior (see
-- 20260920000000): open the transaction explicitly.
begin;

create or replace function private.mobile_idempotency_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  effect_key text := nullif(headers ->> 'x-vsis-idempotency-key', '');
  effect_operation text := nullif(headers ->> 'x-vsis-idempotency-operation', '');
  expected_operation text;
  uid uuid := auth.uid();
  resource_id text;
  payload jsonb;
begin
  -- Legacy clients do not set either header and keep their prior behavior.
  if effect_key is null and effect_operation is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  expected_operation := case tg_table_name
    when 'timesheets' then case tg_op
      when 'INSERT' then 'create_timesheet'
      when 'UPDATE' then 'update_timesheet'
      when 'DELETE' then 'delete_timesheet'
    end
    when 'leaves' then case tg_op
      when 'INSERT' then 'create_leave'
      when 'DELETE' then 'delete_leave'
    end
    when 'reminders' then case tg_op
      when 'INSERT' then 'create_reminder'
      when 'UPDATE' then 'update_reminder'
      when 'DELETE' then 'delete_reminder'
    end
  end;

  if effect_key is null
     or effect_operation is distinct from expected_operation
     or uid is null then
    raise exception 'Invalid mobile idempotency context.' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    resource_id := old.id::text;
  else
    resource_id := new.id::text;
  end if;

  -- Pass the whole resulting row: the canonical fingerprint function selects
  -- the operation's whitelisted columns. Referencing per-table columns inside a
  -- single CASE is not possible here — PL/pgSQL resolves record fields against
  -- NEW/OLD's concrete row type for the whole expression, so a shared trigger
  -- would fail on tables that lack the other tables' columns.
  payload := to_jsonb(coalesce(new, old));

  perform private.claim_idempotency_effect(
    effect_key,
    effect_operation,
    public.idempotency_effect_fingerprint(effect_operation, payload),
    resource_id
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.mobile_idempotency_commit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  effect_key text := nullif(headers ->> 'x-vsis-idempotency-key', '');
  effect_operation text := nullif(headers ->> 'x-vsis-idempotency-operation', '');
begin
  if effect_key is null and effect_operation is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform private.commit_idempotency_effect(
    effect_key,
    effect_operation,
    case when effect_operation like 'create_%' then 201 else 200 end
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
