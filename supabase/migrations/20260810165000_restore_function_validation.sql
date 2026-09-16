-- Remove the fresh-baseline event trigger immediately after the immutable
-- initial schema has replaced the temporary profiles stub with the real table.
drop event trigger if exists drop_fresh_baseline_profiles_stub;
drop function if exists public.drop_fresh_baseline_profiles_stub();
