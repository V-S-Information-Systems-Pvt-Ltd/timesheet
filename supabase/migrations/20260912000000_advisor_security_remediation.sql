-- 20260912000000_advisor_security_remediation.sql
-- Remediate Supabase Security Advisor warnings:
-- 1. Pin search_path on functions with mutable role search paths:
--    - public.check_daily_hours_limit()
--    - public.sync_legacy_role()
-- 2. Revoke execute on internal trigger function from all public PostgREST roles:
--    - public.handle_new_user() (called only by auth.users system trigger)
-- 3. Secure RLS helper functions:
--    - Revoke from public and anon so unauthenticated callers cannot invoke them
--    - Explicitly grant execute to authenticated so PostgreSQL RLS policies can evaluate
--      them without breaking ordinary operations (profile updates, hierarchy traversal, admin checks)

-- 1. Mutable search paths
alter function public.check_daily_hours_limit() set search_path = public, pg_temp;
alter function public.sync_legacy_role() set search_path = public, pg_temp;

-- 2. Revoke internal trigger function from public, anon, authenticated
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- 3. RLS helper security definer functions:
-- Revoke from public and anon, then explicitly grant to authenticated for RLS policy evaluation
revoke all on function public.has_role(text) from public, anon;
grant execute on function public.has_role(text) to authenticated;

revoke all on function public.my_locked_profile_fields() from public, anon;
grant execute on function public.my_locked_profile_fields() to authenticated;

revoke all on function public.team_ids(uuid) from public, anon;
grant execute on function public.team_ids(uuid) to authenticated;
