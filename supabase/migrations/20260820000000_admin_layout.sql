-- Per-admin customizable admin-panel layout (tile order + visibility).
alter table public.profiles
  add column if not exists admin_layout jsonb;