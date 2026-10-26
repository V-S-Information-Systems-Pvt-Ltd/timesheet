---
name: new-migration
description: Scaffold the next numbered PostgreSQL migration in db/migrations/ with this repo's rules (never edit merged migrations, SECURITY DEFINER requirements, delta entry). Use when a schema, function, trigger, grant, or data backfill change is needed.
disable-model-invocation: true
argument-hint: <short_snake_case_name>
---

# New migration

1. Number it: take the highest `NNNN` in `db/migrations/` and add 1 (zero-padded to 4). Check `git ls-tree origin/dev db/migrations/` too, in case another branch already used that number.
2. Create `db/migrations/NNNN_$ARGUMENTS.sql`. Never edit a migration that is already on `origin/dev` or `main`; the PreToolUse guard blocks that. Fix forward with a new file.
3. Write idempotent SQL where you can (`if not exists`, `create or replace`, `drop ... if exists`). Migrations run on pool initialization through `db/migrate-runner.mjs`; never add a second runner.
4. Any `SECURITY DEFINER` function needs:
   - `alter function ... owner to <owner>` set explicitly
   - `set search_path = public, pg_temp` (or narrower)
   - `revoke all ... from public`, then the minimal `grant execute`
   - a security test under `tests/` that covers both the allowed actor and a denied one
5. Keep authorization in parameterized SQL scoped by actor. Never add an unscoped aggregate; `get_timesheet_daily_totals` stays removed.
6. If the migration changes schema, a contract, or auth, add an entry of 10 lines or fewer at the top of `docs/ai-context/ARCHITECTURE_DELTA.md`, dated today.
7. Verify: `npm run db:migrate` against `TEST_DATABASE_URL`, then the relevant `*.int.test.ts`. Use `/verify` to pick the remaining checks. If no test database is available, report the DB tests as skipped.
