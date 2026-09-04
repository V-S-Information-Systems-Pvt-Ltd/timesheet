-- db/migrations/0022_reclassify_title_atomic.sql
-- Atomic title reclassification support (native repository runs transactions directly)
-- Ensure title index is case-insensitive unique
create unique index if not exists titles_lower_name_idx on public.titles (lower(name));
