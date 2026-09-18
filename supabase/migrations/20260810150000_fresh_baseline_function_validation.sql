-- Fresh-baseline compatibility shim for immutable migration 20260810160000.
-- That published migration validates public.is_admin() before creating the
-- referenced profiles table. Provide the two columns needed for validation,
-- then remove this stub immediately before the immutable CREATE TABLE runs.
do $migration$
begin
  -- On a deployed database the real table already exists, so this backfilled
  -- compatibility version is deliberately a no-op.
  if to_regclass('public.profiles') is null then
    execute 'create table public.profiles (id uuid, is_admin boolean)';
    execute $function$
      create function public.drop_fresh_baseline_profiles_stub()
      returns event_trigger
      language plpgsql
      set search_path = pg_catalog, pg_temp
      as $body$
      begin
        if current_query() ~* 'create[[:space:]]+table[[:space:]]+public[.]profiles[[:space:]]*[(]' then
          drop table public.profiles;
        end if;
      end
      $body$
    $function$;
    execute $trigger$
      create event trigger drop_fresh_baseline_profiles_stub
        on ddl_command_start
        when tag in ('CREATE TABLE')
        execute function public.drop_fresh_baseline_profiles_stub()
    $trigger$;
  end if;
end
$migration$;
