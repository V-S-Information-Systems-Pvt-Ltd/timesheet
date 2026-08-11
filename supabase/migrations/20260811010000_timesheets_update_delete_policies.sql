-- Allow users to update/delete their own timesheet entries; admins any.
-- (Select/insert policies already exist from the roles migration.)

create policy "timesheets_update_own" on public.timesheets
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "timesheets_update_admin" on public.timesheets
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

create policy "timesheets_delete_own" on public.timesheets
  for delete to authenticated
  using (auth.uid() = user_id);

create policy "timesheets_delete_admin" on public.timesheets
  for delete to authenticated
  using (public.has_role('admin'));
