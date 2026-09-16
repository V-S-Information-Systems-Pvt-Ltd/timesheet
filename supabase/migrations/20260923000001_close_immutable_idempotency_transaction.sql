-- Fresh-baseline compatibility shim for immutable migration 20260923000000,
-- which opened an explicit transaction but was published without its matching
-- COMMIT. Supabase applies migration files on one session, so this closes that
-- transaction and persists both the function replacements and history row.
commit;
