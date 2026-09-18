# Architecture Constraints

1. Preserve backend-neutral application boundaries. Do not bypass `auth`/`repo` for ordinary feature work.
2. Preserve native/Supabase behavioral and authorization parity.
3. Keep permission role and hierarchy role independent; do not collapse the two axes.
4. Treat signed-in, active-account, role/scope, and resource authorization as separate gates.
5. Add migrations; do not rewrite applied migrations. Cross-backend schema changes require both migration tracks unless the behavior is explicitly backend-specific.
6. Keep browser secrets and mobile credentials out of client-exposed configuration and DTOs.
7. Keep `/api/v1` backward-compatible unless a versioned contract change is explicitly planned; coordinate server/mobile DTO changes.
8. Preserve CSRF/origin protection for cookie-authenticated mutations.
9. Preserve RLS-scoped `get_grouped_report_totals`; do not reintroduce the removed unscoped daily-totals RPC.
10. Any `SECURITY DEFINER` database function needs explicit ownership, grants, `search_path`, and security coverage.
11. Keep native migration/seeding entry points on the shared migration runner; do not duplicate migration logic.
12. Production changes must remain build-compatible with both `supabase` and `native` modes when shared code/contracts change.

Evidence: `AGENTS.md`, `README.md`, `lib/db/repository.ts`, `app/api/_http.ts`, migration tests and migration directories.
