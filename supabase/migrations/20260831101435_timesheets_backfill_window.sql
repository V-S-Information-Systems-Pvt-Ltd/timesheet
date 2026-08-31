-- Keep direct PostgREST mutations subject to the same writable-date rule as
-- the server actions. The existing SELECT policies continue to scope rows;
-- admins retain unrestricted update/delete access.

drop policy if exists "timesheets_update_own" on public.timesheets;
drop policy if exists "timesheets_update_admin" on public.timesheets;
drop policy if exists "timesheets_delete_own" on public.timesheets;
drop policy if exists "timesheets_delete_admin" on public.timesheets;

create policy "timesheets_update_own" on public.timesheets
  for update to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.app_settings s
      where s.id = 1
        and log_date <= current_date
        and (
          (s.backfill_mode = 'days' and log_date >= current_date - s.backfill_window_days)
          or (s.backfill_mode = 'month_start' and log_date >= date_trunc('month', current_date)::date - s.backfill_extra_days)
        )
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.app_settings s
      where s.id = 1
        and log_date <= current_date
        and (
          (s.backfill_mode = 'days' and log_date >= current_date - s.backfill_window_days)
          or (s.backfill_mode = 'month_start' and log_date >= date_trunc('month', current_date)::date - s.backfill_extra_days)
        )
    )
  );

create policy "timesheets_update_admin" on public.timesheets
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

create policy "timesheets_delete_own" on public.timesheets
  for delete to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.app_settings s
      where s.id = 1
        and log_date <= current_date
        and (
          (s.backfill_mode = 'days' and log_date >= current_date - s.backfill_window_days)
          or (s.backfill_mode = 'month_start' and log_date >= date_trunc('month', current_date)::date - s.backfill_extra_days)
        )
    )
  );

create policy "timesheets_delete_admin" on public.timesheets
  for delete to authenticated
  using (public.has_role('admin'));
