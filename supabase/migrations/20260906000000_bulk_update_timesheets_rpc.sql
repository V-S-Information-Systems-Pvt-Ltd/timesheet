-- 20260906000000_bulk_update_timesheets_rpc.sql
-- Phase 4.4 / F08: single-round-trip batch edit for the Supabase adapter,
-- mirroring the atomic semantics of lib/db/native.ts bulkUpdateTimesheets:
--   * a single UPDATE ... FROM (values) statement — one atomic batch;
--   * missing rows are skipped, never inserted (unlike a PostgREST upsert,
--     which would silently resurrect concurrently-deleted rows);
--   * ownership is re-checked inside the same statement (t.user_id = p_actor_id),
--     closing the TOCTOU window between a JS-side owner pre-fetch and the write.
--
-- Security model:
--   * SECURITY DEFINER so the service-role caller can write regardless of RLS.
--   * search_path pinned to public, pg_temp (no search_path hijacking).
--   * Granted ONLY to service_role: the body trusts p_actor_id/p_can_edit_all,
--     so anon/authenticated clients must never be able to invoke it with a
--     forged actor id.
create or replace function public.bulk_update_timesheets(
  p_actor_id uuid,
  p_can_edit_all boolean,
  p_rows jsonb
)
returns table (updated_id uuid)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.timesheets t
  set project_id = v.project_id,
      activity_type_id = v.activity_type_id,
      log_date = v.log_date,
      hours_worked = v.hours_worked,
      work_done = v.work_done
  from jsonb_to_recordset(p_rows) as v(
    id uuid,
    project_id uuid,
    activity_type_id uuid,
    log_date date,
    hours_worked numeric,
    work_done text
  )
  where t.id = v.id
    and (p_can_edit_all or t.user_id = p_actor_id)
  returning t.id;
$$;

revoke all on function public.bulk_update_timesheets(uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.bulk_update_timesheets(uuid, boolean, jsonb) to service_role;