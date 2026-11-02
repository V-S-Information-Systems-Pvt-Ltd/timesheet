// tests/report-leaves.int.test.ts
// Live PostgreSQL coverage for the report leave read: real SQL, date shape,
// ordering, filters and actor scoping.
// Runs only when TEST_DATABASE_URL is set.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { reportingPersistence } from '@/lib/db/reporting'
import type { Actor } from '@/lib/db/types'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const run = url ? it : it.skip

function actorFor(
  id: string,
  email: string,
  permission_role: Actor['permission_role'] = 'user',
  hierarchy_role: Actor['hierarchy_role'] = 'user'
): Actor {
  return { id, email, role: permission_role, permission_role, hierarchy_role, isActive: true }
}

suite('report leave read (live Postgres)', () => {
  const pool = new Pool({ connectionString: url })
  const emailA = 'report.leave.a@example.com'
  const emailB = 'report.leave.b@example.com'
  let userA = ''
  let userB = ''
  const admin = actorFor('00000000-0000-0000-0000-0000000000a1', 'report.leave.admin@example.com', 'admin')

  beforeAll(async () => {
    if (url) {
      process.env.DATABASE_URL = url
    }
    const mk = async (email: string) => {
      const r = await pool.query<{ id: string }>(
        `insert into public.profiles (email, name, role, is_active)
         values ($1, $1, 'user', true)
         on conflict (email) do update set is_active = true
         returning id`,
        [email]
      )
      return r.rows[0].id
    }
    userA = await mk(emailA)
    userB = await mk(emailB)
    // The admin's department scope is read live, so it needs a real profile.
    await pool.query(
      `insert into public.profiles (id, email, name, role, is_active)
       values ($1, $2, $2, 'admin', true)
       on conflict (id) do update set scope_departments = null`,
      [admin.id, admin.email]
    )
    await pool.query(`delete from public.leaves where user_id in ($1, $2)`, [userA, userB])
    await pool.query(
      `insert into public.leaves (user_id, leave_date, reason) values
         ($1, '2099-03-01', 'Older'), ($1, '2099-03-03', 'Newer'), ($2, '2099-03-02', 'Other user')`,
      [userA, userB]
    )
  })

  afterAll(async () => {
    await pool.query(`delete from public.leaves where user_id in ($1, $2)`, [userA, userB])
    await pool.query(`delete from public.profiles where id in ($1, $2, $3)`, [userA, userB, admin.id])
    await pool.end()
  })

  const window = { dateFrom: '2099-03-01', dateTo: '2099-03-31' }

  run('returns plain dates, emails and reasons, newest first', async () => {
    expect(await reportingPersistence.listLeaves(admin, window)).toEqual([
      { leave_date: '2099-03-03', email: emailA, reason: 'Newer' },
      { leave_date: '2099-03-02', email: emailB, reason: 'Other user' },
      { leave_date: '2099-03-01', email: emailA, reason: 'Older' },
    ])
  })

  run('applies the user and date filters', async () => {
    const rows = await reportingPersistence.listLeaves(admin, { userId: userA, dateFrom: '2099-03-02', dateTo: '2099-03-31' })
    expect(rows.map((r) => r.reason)).toEqual(['Newer'])
  })

  run('limits an ordinary user to their own leave', async () => {
    const rows = await reportingPersistence.listLeaves(actorFor(userA, emailA), window)
    expect(rows.map((r) => r.email)).toEqual([emailA, emailA])
    expect(await reportingPersistence.listLeaves(actorFor(userA, emailA), { ...window, userId: userB })).toEqual([])
  })

  run('limits a leader with no team to their own leave', async () => {
    const rows = await reportingPersistence.listLeaves(actorFor(userB, emailB, 'user', 'team_lead'), window)
    expect(rows.map((r) => r.reason)).toEqual(['Other user'])
  })
})
