-- Allow admins to insert timesheet entries for ANY user (admin backfill).
--
-- The only insert policy on timesheets is "timesheets_insert_own_active"
-- (auth.uid() = user_id and an active profile). Without an admin insert
-- policy, the admin "Backfill Yesterday" feature in app/actions.ts fails
-- with an RLS error whenever the target user is not the admin themselves,
-- because the inserted row's user_id differs from the caller's uid.
--
-- Keep the existing self-insert policy for regular users and layer an
-- admin-only insert policy on top.

create policy "timesheets_insert_admin" on public.timesheets
  for insert to authenticated
  with check (public.has_role('admin'));
