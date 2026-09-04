-- db/migrations/0019_mobile_layout.sql
-- Add per-user and workspace default mobile module layout configurations.

alter table public.profiles add column if not exists mobile_layout jsonb;
alter table public.app_settings add column if not exists default_mobile_layout jsonb;
