-- Default time-entry window: the current month plus 5 days before its start.
alter table public.app_settings
  alter column backfill_mode set default 'month_start',
  alter column backfill_extra_days set default 5;

-- Only move installations still on the original factory default.
update public.app_settings
   set backfill_mode = 'month_start', backfill_extra_days = 5, updated_at = now()
 where id = 1 and backfill_mode = 'days' and backfill_window_days = 1 and backfill_extra_days = 0;
