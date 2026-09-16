-- Convergence barrier for databases that recorded the published bootstrap
-- migrations before the additive fresh-baseline compatibility shims existed.
-- Keep the final schema and trigger behavior identical on fresh and deployed
-- paths without changing any published migration contents.

-- A historical deployment may have the email column without the complete
-- constraints. Backfill only missing values, then enforce NOT NULL separately
-- from uniqueness so one existing constraint cannot accidentally mask the
-- other.
update public.profiles p
set email = coalesce(u.email, 'orphan-' || p.id || '@invalid.local')
from auth.users u
where u.id = p.id
  and p.email is null;

update public.profiles
set email = 'orphan-' || id || '@invalid.local'
where email is null;

alter table public.profiles
  alter column email set not null;

do $$
declare
  email_attnum smallint;
begin
  select a.attnum
  into email_attnum
  from pg_catalog.pg_attribute as a
  where a.attrelid = 'public.profiles'::regclass
    and a.attname = 'email'
    and not a.attisdropped;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as c
    where c.conrelid = 'public.profiles'::regclass
      and c.contype in ('p', 'u')
      and c.conkey = array[email_attnum]::smallint[]
  ) then
    alter table public.profiles
      add constraint profiles_email_key unique (email);
  end if;
end
$$;

-- Reapply the corrected trigger bodies. This is intentionally a forward
-- migration: environments that already recorded 20260923000000 converge
-- without replaying that applied version.
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

alter function private.mobile_idempotency_claim() owner to postgres;
alter function private.mobile_idempotency_commit() owner to postgres;

revoke all on function private.mobile_idempotency_claim() from public, anon, authenticated;
revoke all on function private.mobile_idempotency_commit() from public, anon, authenticated;
