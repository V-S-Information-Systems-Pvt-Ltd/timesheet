-- Migration 0020: Workspace Branding
-- Adds app_name, primary_color, and logo_url to app_settings

alter table public.app_settings
  add column if not exists app_name text default 'VSIS Timesheet' not null,
  add column if not exists primary_color text default '#1E73BE' not null,
  add column if not exists logo_url text default null;
