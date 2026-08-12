-- One timesheet entry per user per day.
--
-- The app enforces a writable backfill window and treats the day's entry as
-- a single, editable record. A unique (user_id, log_date) index makes that
-- invariant hold at the database level instead of relying on a racy
-- count-then-insert check in the server action.
--
-- Before applying the index, collapse any duplicate rows that may exist in
-- older data: keep the most recent entry per user + date (ties are broken by
-- id), so the constraint can be created without manual cleanup.

delete from public.timesheets a
using public.timesheets b
where a.user_id = b.user_id
  and a.log_date = b.log_date
  and a.created_at < b.created_at;

delete from public.timesheets a
using public.timesheets b
where a.user_id = b.user_id
  and a.log_date = b.log_date
  and a.id > b.id
  and a.created_at = b.created_at;

create unique index if not exists timesheets_user_date_key
  on public.timesheets (user_id, log_date);
