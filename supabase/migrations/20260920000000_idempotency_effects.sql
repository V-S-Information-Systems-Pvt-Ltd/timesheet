-- Immutable effect evidence for mobile offline replay (T19.2).
--
-- Consolidates what were originally three successor migrations
-- (20260920000000 + 20260921000000 + 20260922000000) into ONE never-applied,
-- atomic file. Reason: a keyed delivery landing between partial applications
-- would have created evidence in an intermediate whole-row fingerprint format
-- that the canonical fingerprint function cannot interpret, producing false
-- IDEMPOTENCY_CONFLICT responses. A single file has no intermediate format and
-- applies as one unit.
--
-- Atomicity: for the eight queued operations the claim, the business write,
-- and the response commit all happen inside the SAME PostgREST statement
-- transaction. There is no separate claim request and no separate ledger
-- commit for these operations.
--
--   * BEFORE trigger (`mobile_idempotency_claim`) atomically claims the key by
--     inserting the immutable effect row in the write's transaction. A
--     concurrent/replayed delivery with the same key serializes on the unique
--     primary key: the loser either replays the committed success or, for a
--     different payload, receives a conflict — never a duplicate write.
--   * AFTER trigger (`mobile_idempotency_commit`) records the committed
--     response status in the same transaction.
--
-- Evidence provenance: the effect fingerprint is computed server-side by the
-- canonical `public.idempotency_effect_fingerprint` function from the
-- resulting business row (whitelisted columns, fixed canonical types), NOT
-- from caller-controlled headers. Key/operation headers are only routing keys
-- scoped by the authenticated actor. This closes the forged-header false-success
-- path: a direct RLS-permitted write cannot bind a different payload to a key.
--
-- Re-entry: a BEFORE ROW trigger cannot fingerprint a whole create_leave batch,
-- so `public.create_leaves_idempotent` claims the batch ONCE and then inserts
-- the rows — the row triggers then re-enter the same transaction. That re-entry
-- is signalled per-transaction (`vsis.idempotency_reentry`) with the exact
-- claimed batch fingerprint and is validated in the claim helper; any OTHER
-- same-transaction re-entry (e.g. a direct multi-row Data API write mapping a
-- key to several distinct rows) raises IDEMPOTENCY_CONFLICT instead of silently
-- binding one key to multiple effects.
--
-- Exposure invariant: this project exposes ONLY `public` and `graphql_public`
-- to the Data API/Grafbase (Supabase 2026 explicit-grants change). `private`
-- must never be exposed; its functions carry no default EXECUTE (explicitly
-- revoked below) and are granted narrowly to `authenticated` where a SECURITY
-- INVOKER path needs them.

-- Do not rely on a migration runner's implicit transaction behavior. In
-- particular, newer pipelined Supabase CLI runners may execute statements
-- outside a transaction unless the migration opens one explicitly.
begin;

create table if not exists public.idempotency_effects (
  key text not null,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operation text not null check (operation in (
    'create_timesheet', 'update_timesheet', 'delete_timesheet',
    'create_leave', 'delete_leave',
    'create_reminder', 'update_reminder', 'delete_reminder'
  )),
  transaction_id bigint not null,
  response_status integer not null default 0,
  -- Server-derived canonical fingerprint of the resulting row effect. Never
  -- taken from request headers; used to distinguish a same-payload replay from
  -- a different-payload key reuse.
  effect_fingerprint text not null default '',
  -- Row identity bound to the effect (for update/delete operations) so a
  -- replayed delivery after the target row is gone is still recognized.
  resource_id text,
  created_at timestamptz not null default now(),
  primary key (key, actor_id, operation)
);

create index if not exists idx_idempotency_effects_created_at
  on public.idempotency_effects(created_at);
-- ON DELETE CASCADE from profiles.actor_id needs an actor_id-leading index
-- (cannot use the (key, actor_id, operation) primary key).
create index if not exists idx_idempotency_effects_actor_id
  on public.idempotency_effects(actor_id);

alter table public.idempotency_effects enable row level security;
revoke all on table public.idempotency_effects from public, anon, authenticated;
grant select on table public.idempotency_effects to authenticated;
-- Server-side admin reads evidence for deleted-resource recovery and deletes
-- expired effects during the 97-day cleanup. Supabase is moving to explicit
-- Data API grants, so grant the least privilege the application actually uses.
grant select, delete on table public.idempotency_effects to service_role;

drop policy if exists idempotency_effects_select_own on public.idempotency_effects;
create policy idempotency_effects_select_own on public.idempotency_effects
  for select to authenticated
  using ((select auth.uid()) = actor_id);

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- 1. Canonical fingerprint (pure; single implementation used by triggers/RPC)
-- ---------------------------------------------------------------------------
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
    -- The header-driven trigger passes one row per call; the keyed RPC passes
    -- the whole batch. Both canonicalise to the same sorted row array.
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
      when 'create_timesheet' then jsonb_build_object(
        'user_id', p_payload ->> 'user_id',
        'project_id', p_payload ->> 'project_id',
        'activity_type_id', p_payload -> 'activity_type_id',
        'hours_worked', round((p_payload ->> 'hours_worked')::numeric, 2),
        'work_done', p_payload ->> 'work_done',
        'log_date', (p_payload ->> 'log_date')::date
      )
      when 'update_timesheet' then jsonb_build_object(
        'id', p_payload ->> 'id',
        'project_id', p_payload ->> 'project_id',
        'activity_type_id', p_payload -> 'activity_type_id',
        'hours_worked', round((p_payload ->> 'hours_worked')::numeric, 2),
        'work_done', p_payload ->> 'work_done',
        'log_date', (p_payload ->> 'log_date')::date
      )
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

  return encode(sha256(convert_to(coalesce(canon, ''), 'UTF8')), 'hex');
end;
$$;

revoke all on function public.idempotency_effect_fingerprint(text, jsonb) from public, anon;
grant execute on function public.idempotency_effect_fingerprint(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Parameterised claim/commit helpers (shared by triggers and the RPC)
-- ---------------------------------------------------------------------------
create or replace function private.claim_idempotency_effect(
  p_key text,
  p_operation text,
  p_fingerprint text,
  p_resource_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  eff_txid bigint;
  eff_status integer;
  eff_fp text;
  reentry jsonb;
begin
  if uid is null then
    raise exception 'Invalid mobile idempotency context.' using errcode = '42501';
  end if;
  if p_key is null or length(p_key) = 0 then
    raise exception 'Invalid idempotency key.' using errcode = '22023';
  end if;

  reentry := nullif(current_setting('vsis.idempotency_reentry', true), '')::jsonb;
  -- The create_leave RPC is the only code path allowed to re-enter this helper
  -- in its own transaction. Bind that marker to the key and operation BEFORE
  -- attempting an insert so a caller cannot supply a different request-header
  -- key and create an additional evidence row.
  if reentry is not null
     and (
       (reentry ->> 'key') is distinct from p_key
       or (reentry ->> 'operation') is distinct from p_operation
     ) then
    raise exception 'IDEMPOTENCY_CONFLICT: Idempotency key reused with a different payload.' using errcode = 'P0001';
  end if;

  insert into public.idempotency_effects
    (key, actor_id, operation, transaction_id, response_status, effect_fingerprint, resource_id)
  values
    (p_key, uid, p_operation, txid_current(), 0, p_fingerprint, p_resource_id)
  on conflict (key, actor_id, operation) do nothing;

  if found then
    return;
  end if;

  select transaction_id, response_status, effect_fingerprint
    into eff_txid, eff_status, eff_fp
    from public.idempotency_effects
    where key = p_key and actor_id = uid and operation = p_operation;

  if eff_txid = txid_current() then
    -- Same-statement re-entry. The ONLY intentional form is the keyed
    -- create_leave RPC, which claims the whole batch ONCE and then lets the
    -- per-row triggers re-enter; it signals that per-transaction with the
    -- exactly-claimed batch fingerprint. Validate before allowing, and reject
    -- every other same-transaction case (e.g. a direct multi-row Data API
    -- write whose rows produce different fingerprints) so one key can never
    -- bind multiple distinct effects.
    if reentry is not null
       and (reentry ->> 'operation') = p_operation
       and (reentry ->> 'fingerprint') is not distinct from eff_fp then
      return;
    end if;
    raise exception 'IDEMPOTENCY_CONFLICT: Idempotency key reused with a different payload.' using errcode = 'P0001';
  end if;

  if eff_status > 0 then
    if eff_fp is not distinct from p_fingerprint then
      raise exception 'Idempotency effect already applied.' using errcode = '23505';
    end if;
    raise exception 'IDEMPOTENCY_CONFLICT: Idempotency key reused with a different payload.' using errcode = 'P0001';
  end if;

  raise exception 'Idempotency effect already applied.' using errcode = '23505';
end;
$$;

create or replace function private.commit_idempotency_effect(
  p_key text,
  p_operation text,
  p_status integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.idempotency_effects
     set response_status = p_status
   where key = p_key
     and actor_id = auth.uid()
     and operation = p_operation
     and transaction_id = txid_current()
     and response_status = 0;
end;
$$;

revoke all on function private.claim_idempotency_effect(text, text, text, text) from public, anon;
revoke all on function private.commit_idempotency_effect(text, text, integer) from public, anon;
grant execute on function private.claim_idempotency_effect(text, text, text, text) to authenticated;
grant execute on function private.commit_idempotency_effect(text, text, integer) to authenticated;
-- The helpers are SECURITY DEFINER but the RPC that calls them is SECURITY
-- INVOKER (authenticated), so the caller needs schema USAGE to resolve the
-- names. EXECUTE remains narrowly granted to exactly these two helpers.
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Header-driven triggers delegate to the shared helpers and the canonical
--    fingerprint function (single-row operations).
-- ---------------------------------------------------------------------------
create or replace function private.mobile_idempotency_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  headers jsonb := coalesce(current_setting('request.headers', true), '{}')::jsonb;
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
  headers jsonb := coalesce(current_setting('request.headers', true), '{}')::jsonb;
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

revoke all on function private.mobile_idempotency_claim() from public, anon, authenticated;
revoke all on function private.mobile_idempotency_commit() from public, anon, authenticated;

drop trigger if exists timesheets_mobile_idempotency_effect on public.timesheets;
drop trigger if exists timesheets_mobile_idempotency_claim on public.timesheets;
create trigger timesheets_mobile_idempotency_claim
  before insert or update or delete on public.timesheets
  for each row execute function private.mobile_idempotency_claim();
drop trigger if exists timesheets_mobile_idempotency_commit on public.timesheets;
create trigger timesheets_mobile_idempotency_commit
  after insert or update or delete on public.timesheets
  for each row execute function private.mobile_idempotency_commit();

drop trigger if exists leaves_mobile_idempotency_effect on public.leaves;
drop trigger if exists leaves_mobile_idempotency_claim on public.leaves;
create trigger leaves_mobile_idempotency_claim
  before insert or delete on public.leaves
  for each row execute function private.mobile_idempotency_claim();
drop trigger if exists leaves_mobile_idempotency_commit on public.leaves;
create trigger leaves_mobile_idempotency_commit
  after insert or delete on public.leaves
  for each row execute function private.mobile_idempotency_commit();

drop trigger if exists reminders_mobile_idempotency_effect on public.reminders;
drop trigger if exists reminders_mobile_idempotency_claim on public.reminders;
create trigger reminders_mobile_idempotency_claim
  before insert or update or delete on public.reminders
  for each row execute function private.mobile_idempotency_claim();
drop trigger if exists reminders_mobile_idempotency_commit on public.reminders;
create trigger reminders_mobile_idempotency_commit
  after insert or update or delete on public.reminders
  for each row execute function private.mobile_idempotency_commit();

-- ---------------------------------------------------------------------------
-- 4. Atomic keyed create_leave: the full batch is fingerprinted before any
--    row is written, so a changed later row is a conflict, not a replay. The
--    row triggers re-enter the same transaction; the re-entry setting below
--    carries the claimed batch fingerprint and is validated in the helper.
-- ---------------------------------------------------------------------------
create or replace function public.create_leaves_idempotent(p_key text, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  fingerprint text;
begin
  if uid is null then
    raise exception 'Invalid mobile idempotency context.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Invalid leave rows payload.' using errcode = '22023';
  end if;

  fingerprint := public.idempotency_effect_fingerprint('create_leave', p_rows);

  -- Signal per-row trigger re-entry with the exactly-claimed key and batch
  -- fingerprint. The shared helper verifies this marker before any insert.
  perform set_config(
    'vsis.idempotency_reentry',
    jsonb_build_object('key', p_key, 'operation', 'create_leave', 'fingerprint', fingerprint)::text,
    true
  );

  perform private.claim_idempotency_effect(p_key, 'create_leave', fingerprint, null);

  insert into public.leaves (user_id, leave_date, reason)
  select (e ->> 'user_id')::uuid, (e ->> 'leave_date')::date, e ->> 'reason'
    from jsonb_array_elements(p_rows) as e;

  perform private.commit_idempotency_effect(p_key, 'create_leave', 201);

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.create_leaves_idempotent(text, jsonb) from public, anon;
grant execute on function public.create_leaves_idempotent(text, jsonb) to authenticated;

-- Belt and suspenders: no private function carries default PUBLIC EXECUTE.
-- Specific grants are the ones above (claim/commit helpers only).
revoke execute on all functions in schema private from public, anon;

commit;
