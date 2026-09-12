// tests/admin-create-concurrency.int.test.ts
// Live PostgreSQL concurrency proof for T21.2 atomic reference creates:
// simultaneous same-name creates yield exactly one row plus one duplicate
// error, and the returned DTO is the inserted row. Runs only when
// TEST_DATABASE_URL is set; otherwise skipped (never green).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
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

suite('admin reference-create concurrency (live Postgres, T21.2)', () => {
  const pool = new Pool({ connectionString: url })
  const admin: Actor = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'create.race.admin@example.com',
    role: 'admin',
    permission_role: 'admin',
    hierarchy_role: 'manager',
    isActive: true,
  }
  const raceName = `Concurrency Race ${Date.now()}`
  const soloName = `Concurrency Solo ${Date.now()}`

  beforeAll(() => {
    if (url) {
      process.env.DATABASE_URL = url
    }
  })

  afterAll(async () => {
    await pool.query(`delete from public.projects where name in ($1, $2)`, [raceName, soloName]).catch(() => {})
    await pool.end()
  })

  run('simultaneous same-name creates yield one row and one duplicate error', async () => {
    const [a, b] = await Promise.all([
      nativeRepository.createProject(admin, { name: raceName }),
      nativeRepository.createProject(admin, { name: raceName }),
    ])
    const successes = [a, b].filter((r) => r.error === null)
    const failures = [a, b].filter((r) => r.error !== null)
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(failures[0].error).toMatch(/already exists/i)

    const rows = await pool.query<{ id: string; name: string }>(
      `select id, name from public.projects where name = $1`,
      [raceName]
    )
    expect(rows.rows).toHaveLength(1)
    if (successes[0].error === null) {
      expect(successes[0].data.id).toBe(rows.rows[0].id)
    }
  })

  run('returned DTO is the inserted row including optional fields', async () => {
    const res = await nativeRepository.createProject(admin, { name: soloName, soNumber: 'SO-77' })
    expect(res.error).toBeNull()
    if (res.error === null) {
      expect(res.data.name).toBe(soloName)
      expect(res.data.so_number).toBe('SO-77')
      expect(typeof res.data.id).toBe('string')
    }
  })
})
