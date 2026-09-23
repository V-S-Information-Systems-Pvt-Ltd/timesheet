-- C06B provider-fence generation. A run id may be reused across a later
-- maintenance window, so the single durable gate row owns a UUID for each
-- fenced window. Publication opens the same window and retains this value.

alter table public.migration_write_gate
  add column if not exists fence_generation uuid;

update public.migration_write_gate
   set fence_generation = gen_random_uuid()
 where fence_generation is null;

alter table public.migration_write_gate
  alter column fence_generation set default gen_random_uuid(),
  alter column fence_generation set not null;

comment on column public.migration_write_gate.fence_generation is
  'Stable UUID for one fenced migration window; retained when that window opens for publication.';
