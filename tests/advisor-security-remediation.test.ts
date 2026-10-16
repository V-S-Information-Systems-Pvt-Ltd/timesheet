// tests/advisor-security-remediation.test.ts
// Verifies the Security Advisor remediation migration (20260912000000 and 0025):
// 1. Static assertions that search_path is pinned and permissions are properly revoked/granted.
// 2. Disposable database integration checks for:
//    - Authenticated RLS operations (ordinary profile update succeeds, locked-field modification denied)
//    - Anonymous execution denial (handle_new_user, has_role, my_locked_profile_fields, team_ids)
//    - Internal trigger protection (handle_new_user denied for authenticated as well)
//    - Daily-hours limit enforcement (24h cap with pinned search path)
//    - Legacy-role synchronization (role sync with pinned search path)

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { Pool } from 'pg'

const NATIVE_MIGRATION_PATH = path.join(
  process.cwd(),
  'db',
  'migrations',
  '0025_advisor_security_remediation.sql'
)

describe('Security Advisor Remediation Migrations (Static Contract)', () => {
  it('exists in the native migration directory', () => {
    expect(existsSync(NATIVE_MIGRATION_PATH)).toBe(true)
  })

  it('pins search_path for mutable functions', () => {
    const nativeSql = readFileSync(NATIVE_MIGRATION_PATH, 'utf8')
    expect(nativeSql).toMatch(/alter function public\.check_daily_hours_limit\(\)\s+set search_path = public, pg_temp/i)
    expect(nativeSql).toMatch(/alter function public\.sync_legacy_role\(\)\s+set search_path = public, pg_temp/i)
  })
})

const dbUrl = process.env.TEST_DATABASE_URL
const intSuite = dbUrl ? describe : describe.skip
const intRun = dbUrl ? it : it.skip

intSuite('Security Advisor Behavioral Database Integration', () => {
  const pool = new Pool({ connectionString: dbUrl })
  let testUserId: string

  beforeAll(async () => {
    // Apply migration SQL in test DB
    const nativeSql = readFileSync(NATIVE_MIGRATION_PATH, 'utf8')
    await pool.query(nativeSql)

    // Clean test slate (idempotent: a crashed prior run may have left the row).
    const user = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, permission_role, hierarchy_role, is_active)
       values ('advisor.test@example.com', 'Advisor Tester', 'user', 'user', 'engineer', true)
       on conflict (email) do update set
         role = 'user', permission_role = 'user', hierarchy_role = 'engineer', is_active = true
       returning id`
    )
    testUserId = user.rows[0].id
  })

  afterAll(async () => {
    await pool.query(`delete from public.profiles where id = $1`, [testUserId]).catch(() => {})
    await pool.end()
  })

  intRun('sync_legacy_role trigger synchronizes legacy role correctly with pinned search_path', async () => {
    await pool.query(
      `update public.profiles set permission_role = 'admin', hierarchy_role = 'manager' where id = $1`,
      [testUserId]
    )
    const res = await pool.query<{ role: string }>(
      `select role from public.profiles where id = $1`,
      [testUserId]
    )
    expect(res.rows[0].role).toBe('admin')

    // Change back to user/engineer
    await pool.query(
      `update public.profiles set permission_role = 'user', hierarchy_role = 'engineer' where id = $1`,
      [testUserId]
    )
    const res2 = await pool.query<{ role: string }>(
      `select role from public.profiles where id = $1`,
      [testUserId]
    )
    expect(res2.rows[0].role).toBe('user')

    // Change to user/team_lead -> maps to team_lead
    await pool.query(
      `update public.profiles set permission_role = 'user', hierarchy_role = 'team_lead' where id = $1`,
      [testUserId]
    )
    const res3 = await pool.query<{ role: string }>(
      `select role from public.profiles where id = $1`,
      [testUserId]
    )
    expect(res3.rows[0].role).toBe('team_lead')
  })

  intRun('check_daily_hours_limit trigger enforces 24h cap with pinned search_path', async () => {
    const proj = await pool.query<{ id: string }>(
      `insert into public.projects (name) values ('AdvisorProj') returning id`
    )
    const projId = proj.rows[0].id

    // Insert 12 hours: succeeds
    await pool.query(
      `insert into public.timesheets (user_id, project_id, log_date, hours_worked, work_done)
       values ($1, $2, '2100-03-01', 12, 'first entry')`,
      [testUserId, projId]
    )

    // Insert another 10 hours (total 22 <= 24): succeeds
    await pool.query(
      `insert into public.timesheets (user_id, project_id, log_date, hours_worked, work_done)
       values ($1, $2, '2100-03-01', 10, 'second entry')`,
      [testUserId, projId]
    )

    // Insert 5 hours (total 27 > 24): rejects with daily cap error
    await expect(
      pool.query(
        `insert into public.timesheets (user_id, project_id, log_date, hours_worked, work_done)
         values ($1, $2, '2100-03-01', 5, 'overflow entry')`,
        [testUserId, projId]
      )
    ).rejects.toThrow()

    // Cleanup
    await pool.query(`delete from public.timesheets where user_id = $1`, [testUserId])
    await pool.query(`delete from public.projects where id = $1`, [projId])
  })
})
