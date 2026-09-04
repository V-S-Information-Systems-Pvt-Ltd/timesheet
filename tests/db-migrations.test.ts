// tests/db-migrations.test.ts
// Static guards over the native db/migrations SQL. The team_ids recursive CTE
// must dedupe visited ids (UNION): with UNION ALL a reporting cycle (admin
// race or out-of-band edit) would make every leader-scoped query recurse
// until the pool exhausts memory.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations')

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const teamIdsMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('function public.team_ids'))

const mobileSessionMigrations = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .filter((m) => m.sql.includes('create table public.mobile_sessions'))

describe('native team_ids definition', () => {
  it('has at least the defining migration and a cycle-safety migration', () => {
    expect(teamIdsMigrations.length).toBeGreaterThanOrEqual(2)
    expect(teamIdsMigrations.some((m) => m.name.startsWith('0006_'))).toBe(true)
    expect(teamIdsMigrations.some((m) => m.name.startsWith('0016_'))).toBe(true)
  })

  it('the latest definition terminates on reporting cycles (UNION, not UNION ALL)', () => {
    const latest = teamIdsMigrations[teamIdsMigrations.length - 1]
    expect(latest.name).toBe('0016_cycle_safe_team_ids.sql')
    // Extract only the latest function body so the legacy UNION ALL in 0006
    // cannot satisfy this assertion.
    const body = latest.sql.slice(latest.sql.indexOf('function public.team_ids'))
    expect(body).toMatch(/\bunion\b/i)
    expect(body).not.toMatch(/union\s+all/i)
  })
})

describe('native mobile sessions schema', () => {
  it('adds the server-side refresh-token session table', () => {
    expect(mobileSessionMigrations).toHaveLength(1)
    const sql = mobileSessionMigrations[0].sql
    expect(sql).toMatch(/refresh_token_hash\s+text\s+not null\s+unique/i)
    expect(sql).toMatch(/previous_token_hash\s+text\s+unique/i)
    expect(sql).toMatch(/references public\.profiles\s*\(id\)\s+on delete cascade/i)
    expect(sql).toMatch(/mobile_sessions_user_active_idx/i)
    expect(sql).toMatch(/mobile_sessions_family_idx/i)
  })
})

// Parity guard: the native REST routes bound leaves.reason and
// reminders.message at 500 chars; the database must enforce the same bounds
// so both backends (and any direct repository caller) behave identically.
const boundTextMigration = migrations
  .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
  .find((m) => m.name === '0017_bound_leave_reminder_text.sql')

describe('native leaves/reminders text-length bounds', () => {
  it('bounds reason and message length at the database level', () => {
    expect(boundTextMigration).toBeDefined()
    expect(boundTextMigration!.sql).toMatch(
      /add constraint leaves_reason_max_len check \(char_length\(reason\) <= 500\) not valid/
    )
    expect(boundTextMigration!.sql).toMatch(
      /add constraint reminders_message_max_len check \(char_length\(message\) <= 500\) not valid/
    )
  })
})
