// tests/password-change-race.int.test.ts
// Live PostgreSQL race tests for T17.2: a password change must serialize
// against refresh-token rotation so no revoked session is resurrected.
// Runs only when TEST_DATABASE_URL is set.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { Pool } from 'pg'
import { changePassword } from '@/lib/auth/native'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { hashPassword } from '@/lib/auth/password'

vi.mock('@/lib/backend/config', () => ({
  IS_NATIVE: true,
  IS_SUPABASE: false,
}))

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const run = url ? it : it.skip

const CURRENT = 'Current1234!'
const NEXT = 'Next5678!'

async function insertSession(
  pool: Pool,
  userId: string,
  tokenHash: string,
  familyId?: string
): Promise<string> {
  const fam =
    familyId ??
    (await pool.query<{ id: string }>(`select gen_random_uuid() as id`)).rows[0].id
  const far = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const res = await pool.query<{ id: string }>(
    `insert into public.mobile_sessions
       (user_id, family_id, refresh_token_hash, device_name, platform, idle_expires_at, absolute_expires_at)
     values ($1, $2, $3, 'test', 'test', $4, $5)
     returning id`,
    [userId, fam, tokenHash, far(30), far(90)]
  )
  return res.rows[0].id
}

suite('password change vs refresh rotation race (live Postgres)', () => {
  const pool = new Pool({ connectionString: url })
  let userId: string

  beforeAll(async () => {
    if (url) {
      process.env.DATABASE_URL = url
    }
    const hash = await hashPassword(CURRENT)
    const userRes = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, is_active, password_hash, session_version)
       values ('pwd.race@example.com', 'Pwd Race', 'user', true, $1, 0)
       on conflict (email) do update set password_hash = excluded.password_hash, session_version = 0, is_active = true
       returning id`,
      [hash]
    )
    userId = userRes.rows[0].id
  })

  afterAll(async () => {
    await pool.query(`delete from public.mobile_sessions where user_id = $1`, [userId])
    await pool.query(`delete from public.profiles where id = $1`, [userId])
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query(`delete from public.mobile_sessions where user_id = $1`, [userId])
    const hash = await hashPassword(CURRENT)
    await pool.query(
      `update public.profiles set password_hash = $1, session_version = 0 where id = $2`,
      [hash, userId]
    )
  })

  run('web change racing a rotation leaves no live session behind', async () => {
    await insertSession(pool, userId, 'race-token-hash-1')

    // Fire both concurrently: whichever order the database serializes them,
    // the final state must contain no resurrected live session.
    const [pwRes] = await Promise.all([
      changePassword(userId, CURRENT, NEXT),
      mobileSessionStore.rotate({
        presentedTokenHash: 'race-token-hash-1',
        replacementTokenHash: 'race-replacement-hash-1',
      }),
    ])

    expect(pwRes.error).toBeNull()

    const live = await pool.query<{ id: string }>(
      `select id from public.mobile_sessions where user_id = $1 and revoked_at is null`,
      [userId]
    )
    expect(live.rows).toHaveLength(0)
  })

  run('mobile change with preserveSessionId keeps only the live caller session', async () => {
    const keptId = await insertSession(pool, userId, 'race-token-hash-2')
    await insertSession(pool, userId, 'race-token-hash-3')

    const [pwRes, rotateRes] = await Promise.all([
      changePassword(userId, CURRENT, NEXT, { preserveSessionId: keptId }),
      mobileSessionStore.rotate({
        presentedTokenHash: 'race-token-hash-3',
        replacementTokenHash: 'race-replacement-hash-3',
      }),
    ])

    expect(pwRes.error).toBeNull()
    // Rotate either won (its replacement must then have been revoked by the
    // password transaction) or lost (revoked before it could rotate).
    expect(['rotated', 'revoked']).toContain(rotateRes.status)

    const live = await pool.query<{ id: string }>(
      `select id from public.mobile_sessions where user_id = $1 and revoked_at is null order by id`,
      [userId]
    )
    expect(live.rows.map((r) => r.id)).toEqual([keptId])
  })

  run('version bump between gate and txn yields session revoked error and leaves password unchanged', async () => {
    const initialHashRes = await pool.query<{ password_hash: string }>(
      `select password_hash from public.profiles where id = $1`,
      [userId]
    )
    const initialHash = initialHashRes.rows[0].password_hash

    // Bump version in database to simulate concurrent revocation/rotation before txn acquires lock
    await pool.query(
      `update public.profiles set session_version = 5 where id = $1`,
      [userId]
    )

    // Expected version 0 (gate-time value) does not match DB version 5
    const res = await changePassword(userId, CURRENT, NEXT, { expectedSessionVersion: 0 })
    expect(res.error).toBe('session revoked — sign in again')

    // Verify password was NOT changed
    const finalHashRes = await pool.query<{ password_hash: string; session_version: number }>(
      `select password_hash, session_version from public.profiles where id = $1`,
      [userId]
    )
    expect(finalHashRes.rows[0].password_hash).toBe(initialHash)
    expect(finalHashRes.rows[0].session_version).toBe(5)
  })
})

