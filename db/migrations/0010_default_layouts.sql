-- 0010_default_layouts.sql
-- Global default panel order for the user dashboard and the admin panel.
-- Stored as single-row (id = 1) JSON on app_settings, editable by the super
-- admin; users with no per-user layout (dashboard_layout / admin_layout null)
-- fall back to these instead of the hardcoded defaults in app/constants.ts.

alter table public.app_settings
  add column if not exists default_dashboard_layout jsonb,
  add column if not exists default_admin_layout jsonb;
