-- 0015_data_integrity_and_concurrency.sql
-- Phase 4.2 Data Integrity & Concurrency Hardening:
-- 1. Enforce per-entry positive hours and 24h ceiling.
-- 2. Harden daily 24h trigger with transaction-scoped advisory lock derived from (user_id, log_date).

-- 1. Bound individual entry hours between > 0 and <= 24
alter table public.timesheets
  drop constraint if exists timesheets_hours_worked_check,
  add constraint timesheets_hours_worked_check check (hours_worked > 0 and hours_worked <= 24);

-- 2. Concurrency-safe daily hours enforcement
create or replace function public.check_daily_hours_limit()
returns trigger as $$
declare
  total numeric;
begin
  -- Transaction-scoped advisory lock derived from user and date to serialize concurrent writes
  perform pg_advisory_xact_lock(hashtext(NEW.user_id::text || ':' || NEW.log_date::text));

  select coalesce(sum(hours_worked), 0) into total
  from public.timesheets
  where user_id = NEW.user_id
    and log_date = NEW.log_date
    and id is distinct from NEW.id;

  if total + NEW.hours_worked > 24 then
    raise exception 'Daily total would exceed 24 hours (%.2fh already logged on %)',
      total, NEW.log_date using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_check_daily_hours on public.timesheets;
create trigger trg_check_daily_hours
  before insert or update on public.timesheets
  for each row
  execute function public.check_daily_hours_limit();
