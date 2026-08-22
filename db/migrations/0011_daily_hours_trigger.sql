-- Database-level trigger to enforce 24h daily cap per user as a safety net.

create or replace function public.check_daily_hours_limit()
returns trigger as $$
declare
  total numeric;
begin
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
