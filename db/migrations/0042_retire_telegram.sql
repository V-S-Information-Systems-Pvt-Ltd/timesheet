-- db/migrations/0042_retire_telegram.sql
-- Retire the Telegram bot command feature. The app no longer builds bot
-- commands or edits bot numbers, so the per-project and per-activity-type
-- numbers added by 0003_telegram_no.sql are dropped. Older backups that still
-- carry `telegram_no` restore normally; the field is ignored.
--
-- Paired with supabase/migrations/20261016000000_retire_telegram.sql.

drop index if exists public.projects_telegram_no_key;
drop index if exists public.activity_types_telegram_no_key;

alter table public.projects drop column if exists telegram_no;
alter table public.activity_types drop column if exists telegram_no;
