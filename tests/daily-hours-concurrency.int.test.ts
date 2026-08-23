// tests/daily-hours-concurrency.int.test.ts
// live Postgres integration test for Phase 4.2: the daily 24-hour trigger in
// db/migrations/0015_data_integrity_and_concurrency.sql must serialize
// concurrent writes for the same user/date via pg_advisory_xact_lock so that
// when two individually-valid inserts would jointly exceed 24h, EXACTLY ONE
// transaction succeeds.
//
// Skipped unless TEST_DATABASE_URL is set (CI native-e2e job and local `npm
// run db:concurrency-test` provide it). Requires migrations up to 0015 applied
// and starts with a clean timesheets/profiles/projects set in that database.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const run = url ? it : it.skip

suite('daily-hours concurrency (24h cap, migration 0015)', () => {
  const pool = new Pool({ connectionString: url })
  const LOG_DATE = '2100-01-01'
  let userId: string
  let projectA: string
  let projectB: string

  beforeAll(async () => {
    // Clean slate for this test.
    await pool.query('truncate table public.timesheets, public.activity_types, public.projects, public.profiles restart identity cascade')
    const user = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, is_active) values ($1, $1, 'user', true) returning id`,
      ['conc.timing@example.com']
    )
    userId = user.rows[0].id
    const pa = await pool.query<{ id: string }>(
      `insert into public.projects (name) values ('ConcPA') returning id`
    )
    const pb = await pool.query<{ id: string }>(
      `insert into public.projects (name) values ('ConcPB') returning id`
    )
    projectA = pa.rows[0].id
    projectB = pb.rows[0].id
  })

  afterAll(async () => {
    await pool.end()
  })

  run('exactly one of two concurrent 15h inserts succeeds (30h would exceed the cap)', async () => {
    const insert = (projectId: string) => {
      const c = new Pool({ connectionString: url })
      return {
        run: () =>
          c
            .query(
              `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
               values ($1, $2, null, $3, 15, 'conc test')`,
              [userId, projectId, LOG_DATE]
            )
            .then(() => ({ ok: true as const }))
            .catch((e) => ({ ok: false as const, err: e as Error }))
            .finally(() => c.end()),
      }
    }

    // Fire both connections concurrently.
    const [r1, r2] = await Promise.all([insert(projectA).run(), insert(projectB).run()])
    const succeeded = [r1, r2].filter((r) => r.ok).length
    const failed = [r1, r2].filter((r) => !r.ok).length

    expect(succeeded).toBe(1)
    expect(failed).toBe(1)

    // The remaining row for that user/date must be 15h (not 30h), proving the
    // loser did not leak a partial write.
    const total = await pool.query<{ h: string }>(
      `select coalesce(sum(hours_worked),0)::float8 as h from public.timesheets where user_id = $1 and log_date = $2`,
      [userId, LOG_DATE]
    )
    expect(Number(total.rows[0].h)).toBe(15)
  })
})