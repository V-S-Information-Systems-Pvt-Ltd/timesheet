BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';
SELECT jsonb_build_object(
'observed_at', clock_timestamp(),
'public_counts', (SELECT jsonb_object_agg(table_name, rows) FROM (SELECT 'profiles' AS table_name, count(*)::bigint AS rows FROM public."profiles"
UNION ALL
SELECT 'projects' AS table_name, count(*)::bigint AS rows FROM public."projects"
UNION ALL
SELECT 'timesheets' AS table_name, count(*)::bigint AS rows FROM public."timesheets"
UNION ALL
SELECT 'leaves' AS table_name, count(*)::bigint AS rows FROM public."leaves"
UNION ALL
SELECT 'reminders' AS table_name, count(*)::bigint AS rows FROM public."reminders"
UNION ALL
SELECT 'app_settings' AS table_name, count(*)::bigint AS rows FROM public."app_settings"
UNION ALL
SELECT 'activity_types' AS table_name, count(*)::bigint AS rows FROM public."activity_types"
UNION ALL
SELECT 'global_reminders' AS table_name, count(*)::bigint AS rows FROM public."global_reminders"
UNION ALL
SELECT 'global_reminder_dismissals' AS table_name, count(*)::bigint AS rows FROM public."global_reminder_dismissals"
UNION ALL
SELECT 'whitelisted_domains' AS table_name, count(*)::bigint AS rows FROM public."whitelisted_domains"
UNION ALL
SELECT 'titles' AS table_name, count(*)::bigint AS rows FROM public."titles"
UNION ALL
SELECT 'audit_logs' AS table_name, count(*)::bigint AS rows FROM public."audit_logs"
UNION ALL
SELECT 'mobile_sessions' AS table_name, count(*)::bigint AS rows FROM public."mobile_sessions"
UNION ALL
SELECT 'rate_limits' AS table_name, count(*)::bigint AS rows FROM public."rate_limits"
UNION ALL
SELECT 'idempotency_keys' AS table_name, count(*)::bigint AS rows FROM public."idempotency_keys"
UNION ALL
SELECT 'idempotency_effects' AS table_name, count(*)::bigint AS rows FROM public."idempotency_effects"
UNION ALL
SELECT 'migration_runs' AS table_name, count(*)::bigint AS rows FROM public."migration_runs"
UNION ALL
SELECT 'migration_record_map' AS table_name, count(*)::bigint AS rows FROM public."migration_record_map"
UNION ALL
SELECT 'migration_identity_journal' AS table_name, count(*)::bigint AS rows FROM public."migration_identity_journal"
UNION ALL
SELECT 'migration_write_gate' AS table_name, count(*)::bigint AS rows FROM public."migration_write_gate"
UNION ALL
SELECT 'migration_record_dispositions' AS table_name, count(*)::bigint AS rows FROM public."migration_record_dispositions"
UNION ALL
SELECT 'migration_retry_history' AS table_name, count(*)::bigint AS rows FROM public."migration_retry_history"
UNION ALL
SELECT 'migration_fresh_keys' AS table_name, count(*)::bigint AS rows FROM public."migration_fresh_keys") q),
'auth_users', (SELECT count(*) FROM auth.users),
'storage_objects', (SELECT count(*) FROM storage.objects),
'normalized_profile_email_collision_groups',(SELECT count(*) FROM (SELECT lower(btrim(email)) FROM public.profiles GROUP BY lower(btrim(email)) HAVING count(*)>1) s),
'normalized_auth_email_collision_groups',(SELECT count(*) FROM (SELECT lower(btrim(email)) FROM auth.users WHERE email IS NOT NULL GROUP BY lower(btrim(email)) HAVING count(*)>1) s),
'profile_without_auth',(SELECT count(*) FROM public.profiles p LEFT JOIN auth.users a ON a.id=p.id WHERE a.id IS NULL),
'auth_without_profile',(SELECT count(*) FROM auth.users a LEFT JOIN public.profiles p ON p.id=a.id WHERE p.id IS NULL),
'profile_auth_email_mismatch',(SELECT count(*) FROM public.profiles p JOIN auth.users a ON a.id=p.id WHERE lower(btrim(p.email)) IS DISTINCT FROM lower(btrim(a.email))),
'normalized_reference_collision_groups',jsonb_build_object(
'projects',(SELECT count(*) FROM (SELECT lower(btrim(name)) FROM public.projects GROUP BY lower(btrim(name)) HAVING count(*)>1)s),
'activity_types',(SELECT count(*) FROM (SELECT lower(btrim(name)) FROM public.activity_types GROUP BY lower(btrim(name)) HAVING count(*)>1)s),
'titles',(SELECT count(*) FROM (SELECT lower(btrim(name)) FROM public.titles GROUP BY lower(btrim(name)) HAVING count(*)>1)s),
'domains',(SELECT count(*) FROM (SELECT lower(btrim(domain)) FROM public.whitelisted_domains GROUP BY lower(btrim(domain)) HAVING count(*)>1)s)),
'settings_wrong_id',(SELECT count(*) FROM public.app_settings WHERE id<>1),
'orphans',jsonb_build_object(
'timesheet_user',(SELECT count(*) FROM public.timesheets t LEFT JOIN public.profiles p ON p.id=t.user_id WHERE p.id IS NULL),
'timesheet_project',(SELECT count(*) FROM public.timesheets t LEFT JOIN public.projects p ON p.id=t.project_id WHERE p.id IS NULL),
'timesheet_activity',(SELECT count(*) FROM public.timesheets t LEFT JOIN public.activity_types a ON a.id=t.activity_type_id WHERE t.activity_type_id IS NOT NULL AND a.id IS NULL),
'leave_user',(SELECT count(*) FROM public.leaves l LEFT JOIN public.profiles p ON p.id=l.user_id WHERE p.id IS NULL),
'reminder_user',(SELECT count(*) FROM public.reminders r LEFT JOIN public.profiles p ON p.id=r.user_id WHERE p.id IS NULL),
'manager',(SELECT count(*) FROM public.profiles p LEFT JOIN public.profiles m ON m.id=p.manager_id WHERE p.manager_id IS NOT NULL AND m.id IS NULL),
'dismissal_user',(SELECT count(*) FROM public.global_reminder_dismissals d LEFT JOIN public.profiles p ON p.id=d.user_id WHERE p.id IS NULL),
'dismissal_reminder',(SELECT count(*) FROM public.global_reminder_dismissals d LEFT JOIN public.global_reminders r ON r.id=d.reminder_id WHERE r.id IS NULL)),
'leaves_over_500',(SELECT count(*) FROM public.leaves WHERE char_length(reason)>500),
'reminders_over_500',(SELECT count(*) FROM public.reminders WHERE char_length(message)>500),
'hours_out_of_range',(SELECT count(*) FROM public.timesheets WHERE hours_worked<=0 OR hours_worked>24),
'hours_more_than_2_decimals',(SELECT count(*) FROM public.timesheets WHERE hours_worked<>round(hours_worked,2)),
'daily_hours_over_24',(SELECT count(*) FROM (SELECT user_id,log_date FROM public.timesheets GROUP BY user_id,log_date HAVING sum(hours_worked)>24)s),
'profile_self_manager',(SELECT count(*) FROM public.profiles WHERE manager_id=id),
'title_hierarchy_mismatch',(SELECT count(*) FROM public.profiles p JOIN public.titles t ON t.name=p.title WHERE p.hierarchy_role<>t.hierarchy_role),
'active_mobile_sessions',(SELECT count(*) FROM public.mobile_sessions WHERE revoked_at IS NULL AND idle_expires_at>now() AND absolute_expires_at>now()),
'unexpired_fresh_keys',(SELECT count(*) FROM public.migration_fresh_keys WHERE expires_at>now()),
'write_gate',(SELECT jsonb_build_object('state',state,'fence_generation',fence_generation) FROM public.migration_write_gate WHERE id=true),
'unvalidated_constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))), '[]'::jsonb) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT c.convalidated)
) AS inventory;
ROLLBACK;

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';
WITH RECURSIVE managers AS (
 SELECT id AS origin, id, manager_id, ARRAY[id] AS path, false AS cycle FROM public.profiles
 UNION ALL
 SELECT m.origin,p.id,p.manager_id,m.path||p.id,p.id=ANY(m.path)
 FROM managers m JOIN public.profiles p ON p.id=m.manager_id WHERE NOT m.cycle AND cardinality(m.path)<100
)
SELECT jsonb_build_object(
'observed_at',clock_timestamp(),
'legacy_role_mismatch',(SELECT count(*) FROM public.profiles WHERE role<>CASE WHEN permission_role IN ('admin','pm','co') THEN permission_role WHEN hierarchy_role IN ('manager','team_lead') THEN hierarchy_role ELSE 'user' END),
'manager_cycle_origins',(SELECT count(DISTINCT origin) FROM managers WHERE cycle),
'profiles_with_nonempty_unknown_title',(SELECT count(*) FROM public.profiles p WHERE btrim(p.title)<>'' AND NOT EXISTS(SELECT 1 FROM public.titles t WHERE t.name=p.title)),
'hierarchy_mismatches_by_axes',(SELECT coalesce(jsonb_agg(s),'[]'::jsonb) FROM (SELECT p.hierarchy_role AS profile_axis,t.hierarchy_role AS title_axis,count(*) AS rows FROM public.profiles p JOIN public.titles t ON t.name=p.title WHERE p.hierarchy_role<>t.hierarchy_role GROUP BY p.hierarchy_role,t.hierarchy_role)s),
'deleted_actor_refs',jsonb_build_object(
'audit',(SELECT count(*) FROM public.audit_logs a LEFT JOIN public.profiles p ON p.id=a.actor_id WHERE a.actor_id IS NOT NULL AND p.id IS NULL),
'idempotency_key',(SELECT count(*) FROM public.idempotency_keys a LEFT JOIN public.profiles p ON p.id=a.actor_id WHERE p.id IS NULL),
'idempotency_effect',(SELECT count(*) FROM public.idempotency_effects a LEFT JOIN public.profiles p ON p.id=a.actor_id WHERE p.id IS NULL),
'mobile_session',(SELECT count(*) FROM public.mobile_sessions a LEFT JOIN public.profiles p ON p.id=a.user_id WHERE p.id IS NULL),
'fresh_key',(SELECT count(*) FROM public.migration_fresh_keys a LEFT JOIN public.profiles p ON p.id=a.actor_id WHERE p.id IS NULL)),
'idempotency_state',jsonb_build_object(
'unclaimed',(SELECT count(*) FROM public.idempotency_keys WHERE claimed_at IS NULL),
'committed_unknown',(SELECT count(*) FROM public.idempotency_keys WHERE committed_unknown),
'without_response',(SELECT count(*) FROM public.idempotency_keys WHERE response_status IS NULL)),
'public_dml_grants',(SELECT coalesce(jsonb_agg(s),'[]'::jsonb) FROM (SELECT grantee,privilege_type,count(*) AS tables FROM information_schema.role_table_grants WHERE table_schema='public' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE') GROUP BY grantee,privilege_type ORDER BY grantee,privilege_type)s),
'public_security_definer_functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef),
'cron_extension_present',EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron'),
'database_bytes',pg_database_size(current_database())
) AS inventory;
ROLLBACK;
