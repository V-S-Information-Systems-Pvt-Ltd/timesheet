-- Project visibility: hide older projects from new entries, and scope a
-- project to departments. Null or empty departments: open to everyone.
-- Existing entries keep their project either way.
alter table public.projects add column if not exists is_hidden boolean not null default false;
alter table public.projects add column if not exists departments text[];
