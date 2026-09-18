-- Fresh-baseline compatibility shim for immutable migration 20260810190000.
-- The initial schema already creates profiles_email_key, while the published
-- follow-up adds the same constraint unconditionally. Drop it only when the
-- follow-up has not already been recorded, allowing the immutable migration to
-- recreate it. Existing deployments therefore remain untouched.
do $$
begin
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260810190000'
  ) then
    alter table public.profiles
      drop constraint if exists profiles_email_key;
  end if;
end
$$;
