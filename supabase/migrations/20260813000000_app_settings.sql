-- App-wide settings table (single row, id = 1).
--
-- backfill_window_days: how far back (in days) regular users may create or
-- edit timesheet entries. Default 1 = today + yesterday are writable; older
-- entries become read-only. Only admins may change it.

create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  backfill_window_days int not null default 1 check (backfill_window_days >= 0),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id, backfill_window_days)
values (1, 1)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

-- Every signed-in user may read the setting (the UI needs it to render the
-- writable date window); only admins may update it.
create policy "app_settings_select_authenticated" on public.app_settings
  for select to authenticated
  using (true);

create policy "app_settings_update_admin" on public.app_settings
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

grant select on public.app_settings to authenticated;
