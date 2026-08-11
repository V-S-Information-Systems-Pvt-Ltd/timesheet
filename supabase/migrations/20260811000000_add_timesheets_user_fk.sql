-- Repoint the timesheets -> user foreign key at public.profiles.
--
-- The live timesheets table was created manually with
-- user_id -> auth.users(id), so PostgREST cannot embed profiles(email)
-- in timesheet queries:
-- "Could not find a relationship between 'timesheets' and 'profiles'".
-- All timesheet user_ids match existing profiles, so the repoint is safe.

alter table public.timesheets
  drop constraint if exists timesheets_user_id_fkey;

alter table public.timesheets
  add constraint timesheets_user_id_fkey
  foreign key (user_id) references public.profiles (id)
  on delete cascade;

notify pgrst, 'reload schema';
