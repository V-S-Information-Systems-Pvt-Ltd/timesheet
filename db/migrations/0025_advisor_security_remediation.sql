-- 0025_advisor_security_remediation.sql
-- Pin search_path on mutable functions for parity with Supabase advisor remediation.

alter function public.check_daily_hours_limit() set search_path = public, pg_temp;
alter function public.sync_legacy_role() set search_path = public, pg_temp;
