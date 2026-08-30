// tests/supabase-migrations.test.ts
// Guards the grant surface of the timesheet daily-totals RPC. The function is
// SECURITY DEFINER and returns every user's hours, so it must never be callable
// by anon/authenticated clients. Regression test for the Phase 4.3 fix — if a
// future migration re-grants it, this fails.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const mobileSessionMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('create table public.mobile_sessions'))

const rpcSql = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('get_timesheet_daily_totals'))

describe('get_timesheet_daily_totals grants', () => {
  it('has at least the defining migration and a restriction migration', () => {
    expect(rpcSql.length).toBeGreaterThanOrEqual(2)
    expect(rpcSql.some((m) => /create or replace function public\.get_timesheet_daily_totals/.test(m.sql))).toBe(true)
    expect(rpcSql.some((m) => /20260902000000/.test(m.name))).toBe(true)
  })

  it('never grants execution to public or anon', () => {
    for (const m of rpcSql) {
      expect(m.sql).not.toMatch(/grant execute on function public\.get_timesheet_daily_totals\(\) to (public|anon)/)
    }
  })

  it('the latest migration restricts execution to service_role only', () => {
    const latest = rpcSql[rpcSql.length - 1]
    expect(latest.name).toBe('20260902000000_restrict_totals_rpc.sql')
    expect(latest.sql).toMatch(/revoke all on function public\.get_timesheet_daily_totals\(\) from .*authenticated/)
    expect(latest.sql).toMatch(/grant execute on function public\.get_timesheet_daily_totals\(\) to service_role/)
  })
})

// team_ids is SECURITY DEFINER and granted to authenticated. Its body must
// only answer for the caller's own subtree (target = auth.uid()); otherwise
// any signed-in user could enumerate arbitrary profiles' report trees via RPC,
// bypassing the profiles_select_* visibility policies.
const teamIdsMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('function public.team_ids'))

describe('team_ids target guard', () => {
  it('has at least the defining migration and a guard migration', () => {
    expect(teamIdsMigrations.length).toBeGreaterThanOrEqual(2)
    expect(teamIdsMigrations.some((m) => /20260819000000/.test(m.name))).toBe(true)
  })

  it('the latest definition refuses targets other than the caller (auth.uid())', () => {
    const latest = teamIdsMigrations[teamIdsMigrations.length - 1]
    expect(latest.name).toBe('20260903000000_guard_team_ids_target.sql')
    // The body must gate the traversal on target = auth.uid()
    expect(latest.sql).toMatch(/when target = auth\.uid\(\)/)
    expect(latest.sql).toMatch(/else array\[\]::uuid\[\]/)
  })
})

describe('mobile sessions grants', () => {
  it('is server-only and cannot be queried through public PostgREST roles', () => {
    expect(mobileSessionMigrations).toHaveLength(1)
    const sql = mobileSessionMigrations[0].sql
    expect(sql).toMatch(/alter table public\.mobile_sessions enable row level security/i)
    expect(sql).toMatch(/revoke all on table public\.mobile_sessions from public, anon, authenticated/i)
  })
})

// bulk_update_timesheets is a SECURITY DEFINER write RPC that trusts its
// p_actor_id / p_can_edit_all arguments. It must never be callable by
// anon/authenticated (they could forge an actor id and edit arbitrary rows);
// only the service-role admin client may invoke it.
const bulkUpdateMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('function public.bulk_update_timesheets'))

describe('bulk_update_timesheets security', () => {
  it('is defined in exactly one SECURITY DEFINER migration with a pinned search_path', () => {
    expect(bulkUpdateMigrations).toHaveLength(1)
    const sql = bulkUpdateMigrations[0].sql
    expect(sql).toMatch(/create or replace function public\.bulk_update_timesheets/)
    expect(sql).toMatch(/security definer/i)
    expect(sql).toMatch(/set search_path = public, pg_temp/i)
  })

  it('is granted to service_role only, never to public/anon/authenticated', () => {
    for (const m of bulkUpdateMigrations) {
      expect(m.sql).toMatch(
        /revoke all on function public\.bulk_update_timesheets\(uuid, boolean, jsonb\) from public, anon, authenticated/
      )
      expect(m.sql).toMatch(
        /grant execute on function public\.bulk_update_timesheets\(uuid, boolean, jsonb\) to service_role/
      )
      expect(m.sql).not.toMatch(
        /grant execute on function public\.bulk_update_timesheets\(uuid, boolean, jsonb\) to (public|anon|authenticated)/
      )
    }
  })
})
