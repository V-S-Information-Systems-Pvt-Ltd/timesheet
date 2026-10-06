-- Preserve tile presentation for existing reminders and older clients.
alter table public.global_reminders
  add column display_as_banner boolean not null default false;
