-- 20260827000000_default_layouts.sql
-- Global default panel order for the user dashboard and the admin panel.
-- Mirrors db/migrations/0010_default_layouts.sql. Editable by the super admin;
-- users with no per-user layout fall back to these.

alter table public.app_settings
  add column if not exists default_dashboard_layout jsonb,
  add column if not exists default_admin_layout jsonb;
