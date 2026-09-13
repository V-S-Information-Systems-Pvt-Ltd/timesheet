-- 20260914000000_restore_backup_tx.sql
-- Atomic transactional restore procedure for Supabase mode.
-- Wraps projects, activity types, timesheets, leaves, and reminders into a single transaction.
-- If any error occurs, PostgreSQL rolls back all mutations automatically.

create or replace function public.restore_backup_tx(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_elem jsonb;
  v_name text;
  v_email text;
  v_project_name text;
  v_activity_type_name text;
  v_user_id uuid;
  v_project_id uuid;
  v_activity_type_id uuid;
  v_log_date date;
  v_leave_date date;
  v_reason text;
  v_hours numeric;
  v_work_done text;
  v_current_hours numeric;
  v_created_projects int := 0;
  v_created_activity_types int := 0;
  v_created_timesheets int := 0;
  v_created_leaves int := 0;
  v_created_reminders int := 0;
  v_created_global_reminders int := 0;
  v_skipped int := 0;
begin
  -- Serialize concurrent restore executions to prevent deduplication races
  lock table public.projects, public.activity_types, public.timesheets, public.leaves, public.reminders, public.global_reminders in exclusive mode;

  -- 1. Projects: insert missing by name
  if p_payload->'projects' is not null then
    for v_elem in select * from jsonb_array_elements(p_payload->'projects')
    loop
      v_name := trim(coalesce(v_elem->>'name', ''));
      if v_name <> '' then
        if not exists (select 1 from public.projects where name = v_name) then
          insert into public.projects (name, so_number, telegram_no)
          values (
            v_name,
            v_elem->>'so_number',
            v_elem->>'telegram_no'
          );
          v_created_projects := v_created_projects + 1;
        end if;
      end if;
    end loop;
  end if;

  -- 2. Activity Types: insert missing by name
  if p_payload->'activityTypes' is not null then
    for v_elem in select * from jsonb_array_elements(p_payload->'activityTypes')
    loop
      v_name := trim(coalesce(v_elem->>'name', ''));
      if v_name <> '' then
        if not exists (select 1 from public.activity_types where name = v_name) then
          insert into public.activity_types (name, is_active, telegram_no)
          values (
            v_name,
            coalesce((v_elem->>'is_active')::boolean, true),
            v_elem->>'telegram_no'
          );
          v_created_activity_types := v_created_activity_types + 1;
        end if;
      end if;
    end loop;
  end if;

  -- 3. Timesheets: skip exact duplicates and respect 24h cap
  if p_payload->'timesheets' is not null then
    for v_elem in select * from jsonb_array_elements(p_payload->'timesheets')
    loop
      v_email := lower(trim(coalesce(v_elem->>'email', '')));
      v_project_name := trim(coalesce(v_elem->>'project', ''));
      v_activity_type_name := trim(coalesce(v_elem->>'activity_type', ''));
      v_log_date := (v_elem->>'log_date')::date;
      v_hours := coalesce((v_elem->>'hours_worked')::numeric, 0);
      v_work_done := coalesce(nullif(trim(regexp_replace(coalesce(v_elem->>'work_done', ''), '<[^>]*>', '', 'g')), ''), 'restored entry');
      if length(v_work_done) > 2000 then
        v_work_done := substr(v_work_done, 1, 2000);
      end if;

      select id into v_user_id from public.profiles where lower(email) = v_email;
      select id into v_project_id from public.projects where name = v_project_name;
      if v_activity_type_name <> '' then
        select id into v_activity_type_id from public.activity_types where name = v_activity_type_name;
      else
        v_activity_type_id := null;
      end if;

      if v_user_id is null or v_project_id is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      -- Check exact duplicate
      if exists (
        select 1 from public.timesheets
        where user_id = v_user_id
          and log_date = v_log_date
          and project_id = v_project_id
          and (
            (v_activity_type_id is null and activity_type_id is null) or
            activity_type_id = v_activity_type_id
          )
          and hours_worked = v_hours
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      -- Check 24h daily cap
      select coalesce(sum(hours_worked), 0) into v_current_hours
      from public.timesheets
      where user_id = v_user_id and log_date = v_log_date;

      if v_current_hours + v_hours > 24 then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      insert into public.timesheets (
        user_id, project_id, activity_type_id, log_date, hours_worked, work_done
      ) values (
        v_user_id, v_project_id, v_activity_type_id, v_log_date, v_hours, v_work_done
      );
      v_created_timesheets := v_created_timesheets + 1;
    end loop;
  end if;

  -- 4. Leaves: skip duplicates via on conflict
  if p_payload->'leaves' is not null then
    for v_elem in select * from jsonb_array_elements(p_payload->'leaves')
    loop
      v_email := lower(trim(coalesce(v_elem->>'email', '')));
      select id into v_user_id from public.profiles where lower(email) = v_email;
      if v_user_id is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      v_leave_date := (v_elem->>'leave_date')::date;
      v_reason := coalesce(v_elem->>'reason', '');

      insert into public.leaves (user_id, leave_date, reason)
      values (v_user_id, v_leave_date, v_reason)
      on conflict (user_id, leave_date) do nothing;

      if found then
        v_created_leaves := v_created_leaves + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    end loop;
  end if;

  -- 5. Reminders
  if p_payload->'reminders' is not null then
    for v_elem in select * from jsonb_array_elements(p_payload->'reminders')
    loop
      v_email := lower(trim(coalesce(v_elem->>'email', '')));
      select id into v_user_id from public.profiles where lower(email) = v_email;
      if v_user_id is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if exists (
        select 1 from public.reminders
        where user_id = v_user_id
          and message = coalesce(v_elem->>'message', '')
          and remind_at = (v_elem->>'remind_at')::timestamptz
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      insert into public.reminders (user_id, message, remind_at, done)
      values (
        v_user_id,
        coalesce(v_elem->>'message', ''),
        (v_elem->>'remind_at')::timestamptz,
        coalesce((v_elem->>'done')::boolean, false)
      );
      v_created_reminders := v_created_reminders + 1;
    end loop;
  end if;

  -- 6. Global reminders
  if p_payload->'globalReminders' is not null then
    for v_elem in select * from jsonb_array_elements(p_payload->'globalReminders')
    loop
      if exists (
        select 1 from public.global_reminders
        where message = coalesce(v_elem->>'message', '')
          and remind_at = (v_elem->>'remind_at')::timestamptz
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      insert into public.global_reminders (message, remind_at)
      values (
        coalesce(v_elem->>'message', ''),
        (v_elem->>'remind_at')::timestamptz
      );
      v_created_global_reminders := v_created_global_reminders + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'created', jsonb_build_object(
      'projects', v_created_projects,
      'activityTypes', v_created_activity_types,
      'timesheets', v_created_timesheets,
      'leaves', v_created_leaves,
      'reminders', v_created_reminders,
      'globalReminders', v_created_global_reminders
    ),
    'skipped', v_skipped,
    'error', null
  );
end;
$$;

revoke all on function public.restore_backup_tx(jsonb) from public, anon, authenticated;
grant execute on function public.restore_backup_tx(jsonb) to service_role;
