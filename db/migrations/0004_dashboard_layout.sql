-- db/migrations/0004_dashboard_layout.sql
-- Per-user dashboard tile customization and the default "Internal" project.
--
-- Idempotent: safe to re-run after a partial/manual application.

-- Tile order/visibility for the dashboard user tab (jsonb, null = default).
alter table public.profiles
  add column if not exists dashboard_layout jsonb;

-- Default project for the Log Time form; the Telegram command builder treats
-- entries against it specially (prefers the activity type's bot number).
insert into public.projects (name, telegram_no)
select v.name, v.telegram_no
from (values ('Internal', 1000)) as v(name, telegram_no)
where not exists (select 1 from public.projects p where p.name = v.name);