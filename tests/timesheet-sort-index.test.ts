import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

const nativeSql = readFileSync('db/migrations/0038_timesheet_list_sort_index.sql', 'utf8')
const supabaseSql = readFileSync('supabase/migrations/20261006000000_timesheet_list_sort_index.sql', 'utf8')
const ddl = (sql: string) => sql.replace(/--[^\n]*/g, '').trim()

describe('timesheet list sort index', () => {
  it('keeps native and Supabase deployment DDL identical and transaction-compatible', () => {
    expect(ddl(nativeSql)).toBe(ddl(supabaseSql))
    expect(ddl(nativeSql)).not.toMatch(/concurrently|drop|unique/i)
  })

  it.skipIf(!process.env.TEST_DATABASE_URL)('supports stable ordered reads and repeat execution in PostgreSQL', async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query('create temporary table d2_timesheets (id integer primary key, log_date date not null, created_at timestamptz not null) on commit drop')
      await client.query(`insert into d2_timesheets values
        (1, '2026-10-03', '2026-10-03T08:00:00Z'),
        (2, '2026-10-04', '2026-10-04T08:00:00Z'),
        (3, '2026-10-04', '2026-10-04T08:00:00Z'),
        (4, '2026-10-04', '2026-10-04T09:00:00Z')`)
      // Execute the deployment statement on a session-local relation, never public data.
      const sql = ddl(nativeSql).replace('public.timesheets', 'd2_timesheets')
      await client.query(sql)
      await client.query(sql)
      await client.query('set local enable_seqscan = off')
      const query = 'select id from d2_timesheets order by log_date desc, created_at desc, id desc limit 3'
      const result = await client.query(query)
      expect(result.rows.map(row => row.id)).toEqual([4, 3, 2])
      const plan = await client.query(`explain (format json) ${query}`)
      const serialized = JSON.stringify(plan.rows[0]['QUERY PLAN'])
      expect(serialized).toContain('idx_timesheets_logdate_created')
      expect(serialized).not.toContain('"Node Type":"Sort"')
      await expect(client.query('insert into d2_timesheets values (5, null, now())')).rejects.toMatchObject({ code: '23502' })
    } finally {
      await client.query('rollback')
      client.release()
      await pool.end()
    }
  })
})
