// tests/restore.int.test.ts
// Live PostgreSQL late-failure test for T19.1: an induced failure in a LATE
// restore category must roll back the whole restore (atomicity) and report
// zero committed counts. Runs only when TEST_DATABASE_URL is set.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { Pool } from 'pg'
import { nativeRepository } from '@/lib/db/native'

vi.mock('@/lib/backend/config', () => ({
  IS_NATIVE: true,
  IS_SUPABASE: false,
}))

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const run = url ? it : it.skip

const admin = {
  id: 'restore-admin',
  email: 'restore.admin@example.com',
  role: 'admin' as const,
  permission_role: 'admin' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

suite('native restoreBackup late-failure atomicity (live Postgres)', () => {
  const pool = new Pool({ connectionString: url })
  let userId: string

  beforeAll(async () => {
    if (url) {
      process.env.DATABASE_URL = url
    }
    const userRes = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, is_active)
       values ('restore.user@example.com', 'Restore User', 'user', true)
       on conflict (email) do update set is_active = true
       returning id`
    )
    userId = userRes.rows[0].id
  })

  afterAll(async () => {
    await pool.query(`delete from public.timesheets where user_id = $1`, [userId])
    await pool.query(`delete from public.leaves where user_id = $1`, [userId])
    await pool.query(`delete from public.reminders where user_id = $1`, [userId])
    await pool.query(`delete from public.projects where name like 'RestoreProj-%'`)
    await pool.query(`delete from public.profiles where id = $1`, [userId])
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query(`delete from public.timesheets where user_id = $1`, [userId])
    await pool.query(`delete from public.leaves where user_id = $1`, [userId])
    await pool.query(`delete from public.reminders where user_id = $1`, [userId])
    await pool.query(`delete from public.projects where name like 'RestoreProj-%'`)
  })

  run('failure in the late reminders category rolls back early-category writes', async () => {
    const stamp = Date.now()
    const before = await pool.query<{ c: string }>(
      `select count(*)::text as c from public.projects where name like 'RestoreProj-%'`
    )

    // Early categories (projects, timesheets, leaves) are valid; the LATE
    // reminders category violates the 500-char DB CHECK constraint, aborting
    // the transaction. Atomicity requires zero committed counts and no
    // leftover rows from the early categories.
    const result = await nativeRepository.restoreBackup(
      { ...admin, id: admin.id },
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        projects: [{ name: `RestoreProj-${stamp}`, so_number: null, telegram_no: null }],
        activityTypes: [],
        timesheets: [],
        leaves: [{ email: 'restore.user@example.com', leave_date: '2099-02-01', reason: 'ok' }],
        reminders: [
          {
            email: 'restore.user@example.com',
            message: 'x'.repeat(501),
            remind_at: '2099-02-01T10:00:00.000Z',
            done: false,
          },
        ],
        globalReminders: [],
      } as never
    )

    expect(result.error).not.toBeNull()
    expect(result.created).toEqual({ projects: 0, activityTypes: 0, timesheets: 0, leaves: 0, reminders: 0, globalReminders: 0 })
    expect(result.skipped).toBe(0)

    const afterProjects = await pool.query<{ c: string }>(
      `select count(*)::text as c from public.projects where name like 'RestoreProj-%'`
    )
    expect(afterProjects.rows[0].c).toBe(before.rows[0].c)
    const leaves = await pool.query(`select id from public.leaves where user_id = $1`, [userId])
    expect(leaves.rows).toHaveLength(0)
  })
})
