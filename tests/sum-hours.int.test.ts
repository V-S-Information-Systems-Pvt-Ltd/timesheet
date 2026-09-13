// tests/sum-hours.int.test.ts
// Live PostgreSQL adversarial tests for T18.1 sumHoursForUserDates:
// deduplication, sparse pairs, chunk boundaries, and actor scoping.
// Runs only when TEST_DATABASE_URL is set.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { Pool } from 'pg'
import { nativeRepository } from '@/lib/db/native'
import type { Actor } from '@/lib/db/repository'

vi.mock('@/lib/backend/config', () => ({
  IS_NATIVE: true,
  IS_SUPABASE: false,
}))

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const run = url ? it : it.skip

function actorFor(id: string, email: string, permission_role: Actor['permission_role'] = 'user'): Actor {
  return { id, email, role: permission_role, permission_role, hierarchy_role: 'user', isActive: true }
}

suite('sumHoursForUserDates adversarial cases (live Postgres)', () => {
  const pool = new Pool({ connectionString: url })
  let userA = ''
  let userB = ''
  let projectId = ''
  const admin = actorFor('00000000-0000-0000-0000-000000000000', 'sum.admin@example.com', 'admin')

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
    userA = await mk('sum.usera@example.com')
    userB = await mk('sum.userb@example.com')
    const p = await pool.query<{ id: string }>(
      `insert into public.projects (name) values ('SumHours Tracer Project')
       on conflict (name) do update set name = excluded.name
       returning id`
    )
    projectId = p.rows[0].id
  })

  afterAll(async () => {
    await pool.query(`delete from public.timesheets where user_id in ($1, $2)`, [userA, userB])
    await pool.query(`delete from public.profiles where id in ($1, $2)`, [userA, userB])
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query(`delete from public.timesheets where user_id in ($1, $2)`, [userA, userB])
  })

  async function log(userId: string, logDate: string, hours: number) {
    await pool.query(
      `insert into public.timesheets (user_id, project_id, log_date, hours_worked, work_done)
       values ($1, $2, $3, $4, 'tracer')`,
      [userId, projectId, logDate, hours]
    )
  }

  run('repeated pairs are counted once and missing pairs are zero', async () => {
    await log(userA, '2099-03-01', 4)
    const totals = await nativeRepository.sumHoursForUserDates(admin, [
      { userId: userA, logDate: '2099-03-01' },
      { userId: userA, logDate: '2099-03-01' },
      { userId: userA, logDate: '2099-03-02' },
    ])
    expect(totals.get(`${userA}:2099-03-01`)).toBe(4)
    expect(totals.get(`${userA}:2099-03-02`)).toBe(0)
  })

  run('sparse pairs never cross-match (ordinality, not cross product)', async () => {
    // Seed the off-diagonal cell that a cross-product join would wrongly hit.
    await log(userA, '2099-04-02', 7)
    const totals = await nativeRepository.sumHoursForUserDates(admin, [
      { userId: userA, logDate: '2099-04-01' },
      { userId: userB, logDate: '2099-04-02' },
    ])
    expect(totals.get(`${userA}:2099-04-01`)).toBe(0)
    expect(totals.get(`${userB}:2099-04-02`)).toBe(0)
    // Cross-product contamination would report 7 for one of the above.
    expect([...totals.values()].every((v) => v === 0)).toBe(true)
  })

  run('more than one 500-pair chunk stays complete', async () => {
    await log(userA, '2099-10-01', 3)
    await log(userB, '2099-10-02', 5)
    // 2 seeded pairs + 250 unique dates x 2 users = 502 distinct pairs.
    const uniqueDates: string[] = []
    for (let m = 1; m <= 9; m++) {
      for (let d = 1; d <= 28; d++) {
        uniqueDates.push(`2099-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
      }
    }
    const big = [
      { userId: userA, logDate: '2099-10-01' },
      { userId: userB, logDate: '2099-10-02' },
      ...uniqueDates.slice(0, 250).map((dt) => ({ userId: userA, logDate: dt })),
      ...uniqueDates.slice(0, 250).map((dt) => ({ userId: userB, logDate: dt })),
    ]
    expect(new Set(big.map((p) => `${p.userId}:${p.logDate}`)).size).toBeGreaterThan(500)

    const totals = await nativeRepository.sumHoursForUserDates(admin, big)
    expect(totals.size).toBe(new Set(big.map((p) => `${p.userId}:${p.logDate}`)).size)
    expect(totals.get(`${userA}:2099-10-01`)).toBe(3)
    expect(totals.get(`${userB}:2099-10-02`)).toBe(5)
  })

  run('non-admin actors are scoped to their own totals', async () => {
    await log(userA, '2099-08-01', 6)
    await log(userB, '2099-08-01', 6)
    const totals = await nativeRepository.sumHoursForUserDates(actorFor(userA, 'sum.usera@example.com'), [
      { userId: userA, logDate: '2099-08-01' },
      { userId: userB, logDate: '2099-08-01' },
    ])
    expect(totals.get(`${userA}:2099-08-01`)).toBe(6)
    expect(totals.get(`${userB}:2099-08-01`)).toBe(0)
  })
})
