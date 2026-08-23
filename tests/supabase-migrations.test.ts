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