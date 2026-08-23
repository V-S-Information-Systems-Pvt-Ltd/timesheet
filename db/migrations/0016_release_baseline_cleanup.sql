-- db/migrations/0016_release_baseline_cleanup.sql
-- Release 1.0.0 migration consolidation.
--
-- The 15 per-feature migrations (0001_initial_schema …
-- 0015_data_integrity_and_concurrency) were merged into the single idempotent
-- baseline 0001_release_1_0_0_schema.sql, which the runner now applies on
-- existing databases (it is safe to re-run). This migration removes the stale
-- tracking rows for the deleted files so public.schema_migrations only
-- references migrations that exist on disk.
delete from public.schema_migrations
where name in (
  '0001_initial_schema.sql',
  '0002_features.sql',
  '0003_telegram_no.sql',
  '0004_dashboard_layout.sql',
  '0005_multi_entries.sql',
  '0006_user_hierarchy.sql',
  '0007_admin_layout.sql',
  '0008_perf_indexes.sql',
  '0009_separate_roles.sql',
  '0010_default_layouts.sql',
  '0011_daily_hours_trigger.sql',
  '0012_audit_logs.sql',
  '0013_whitelisted_domains.sql',
  '0014_titles.sql',
  '0015_data_integrity_and_concurrency.sql'
);
