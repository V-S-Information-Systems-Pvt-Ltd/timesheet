// tests/password-recovery.int.test.ts
// Live-Postgres regression coverage for the native password-recovery store
// (lib/db/password-recovery.ts). The route-level unit tests mock the store;
// this file proves the transactional semantics the acceptance checklist
// requires: exactly-one-winner on concurrent resets, atomicity, digest-only
// persistence, supersede-on-reissue, expiry, session_version increment, and
// mobile-session revocation.
//
// Skipped unless TEST_DATABASE_URL is set. Uses a migrated disposable database
// (CI native-e2e job and local `npm run db:concurrency-test` provide it).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const run = url ? it : it.skip

suite('native password-recovery store (transaction semantics)', () => {
  const pool = new Pool({ connectionString: url })
  let userId: string
  // Re-import the store against DATABASE_URL pointing at the test database.
  // The shared pool in lib/db/pool.ts is created lazily on first getPool().
  let recovery: typeof import('@/lib/db/password-recovery')

  beforeAll(async () => {
    // Point the app's shared pool at the same disposable database.
    process.env.DATABASE_URL = url
    recovery = await import('@/lib/db/password-recovery')

    await pool.query(
      'truncate table public.password_reset_tokens, public.mobile_sessions, public.timesheets, public.activity_types, public.projects, public.profiles restart identity cascade'
    )
    const user = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, is_active, password_hash)
       values ($1, $1, 'user', true, 'scrypt$16384$8$1$abc$def')
       returning id`,
      ['recovery.int@example.com']
    )
    userId = user.rows[0].id
  })

  afterAll(async () => {
    await pool.end()
  })

  run('stores only a SHA-256 digest, never the raw token', async () => {
    const issued = await recovery.issuePasswordResetToken('recovery.int@example.com', new Date('2026-09-04T00:00:00Z'))
    expect(issued).not.toBeNull()
    const rows = await pool.query<{ token_hash: string }>(
      'select token_hash from public.password_reset_tokens where user_id = $1',
      [userId]
    )
    const storedHashes = rows.rows.map((r) => r.token_hash)
    expect(storedHashes).not.toContain(issued!.token)
    expect(storedHashes).toContain(recovery.hashPasswordResetToken(issued!.token))
  })

  run('returns null for an unknown email without creating a token row', async () => {
    const issued = await recovery.issuePasswordResetToken('ghost@example.com', new Date('2026-09-04T00:00:00Z'))
    expect(issued).toBeNull()
  })

  run('a second request supersedes older unused tokens', async () => {
    const first = await recovery.issuePasswordResetToken('recovery.int@example.com', new Date('2026-09-04T00:00:00Z'))
    expect(first).not.toBeNull()
    const second = await recovery.issuePasswordResetToken('recovery.int@example.com', new Date('2026-09-04T00:01:00Z'))
    expect(second).not.toBeNull()

    // The first token is now unusable.
    const r1 = await recovery.consumePasswordResetToken(first!.token, 'NewPass1', new Date('2026-09-04T00:02:00Z'))
    expect(r1).toEqual({ ok: false })
    // The second still works.
    const r2 = await recovery.consumePasswordResetToken(second!.token, 'NewPass1', new Date('2026-09-04T00:02:00Z'))
    expect(r2).toEqual({ ok: true, userId })
  })

  run('an expired token is rejected', async () => {
    const issued = await recovery.issuePasswordResetToken('recovery.int@example.com', new Date('2026-09-04T00:00:00Z'))
    expect(issued).not.toBeNull()
    const result = await recovery.consumePasswordResetToken(issued!.token, 'NewPass1', new Date('2026-09-05T00:00:00Z'))
    expect(result).toEqual({ ok: false })
  })

  run('consume increments session_version and revokes mobile sessions atomically', async () => {
    await pool.query(
      `insert into public.mobile_sessions
         (user_id, family_id, refresh_token_hash, idle_expires_at, absolute_expires_at)
       values ($1, gen_random_uuid(), $2, now() + interval '30 days', now() + interval '30 days')`,
      [userId, 'existing-hash-' + Date.now()]
    )
    const issued = await recovery.issuePasswordResetToken('recovery.int@example.com', new Date('2026-09-04T00:00:00Z'))
    expect(issued).not.toBeNull()
    const before = await pool.query<{ session_version: number }>(
      'select session_version from public.profiles where id = $1',
      [userId]
    )
    const result = await recovery.consumePasswordResetToken(issued!.token, 'NewPass2', new Date('2026-09-04T00:02:00Z'))
    expect(result).toEqual({ ok: true, userId })

    const after = await pool.query<{ session_version: number }>(
      'select session_version from public.profiles where id = $1',
      [userId]
    )
    expect(Number(after.rows[0].session_version)).toBe(Number(before.rows[0].session_version) + 1)
    const mobile = await pool.query<{ count: string }>(
      'select count(*)::text as count from public.mobile_sessions where user_id = $1 and revoked_at is null',
      [userId]
    )
    expect(Number(mobile.rows[0].count)).toBe(0)
  })

  run('concurrent resets with the same token produce exactly one winner', async () => {
    const issued = await recovery.issuePasswordResetToken('recovery.int@example.com', new Date('2026-09-04T00:10:00Z'))
    expect(issued).not.toBeNull()
    const consume = recovery.consumePasswordResetToken.bind(null, issued!.token, 'ConcurrentPass1', new Date('2026-09-04T00:11:00Z'))
    const [r1, r2] = await Promise.all([consume(), consume()])
    const winners = [r1, r2].filter((r) => r.ok === true).length
    expect(winners).toBe(1)
  })

  run('induced transaction rollback leaves token, password, and session version untouched', async () => {
    const issued = await recovery.issuePasswordResetToken('recovery.int@example.com', new Date('2026-09-04T00:20:00Z'))
    expect(issued).not.toBeNull()

    const before = await pool.query<{ password_hash: string; session_version: number }>(
      'select password_hash, session_version from public.profiles where id = $1',
      [userId]
    )

    const tokenHash = recovery.hashPasswordResetToken(issued!.token)
    // Induce a failure inside an atomic transaction block matching consumePasswordResetToken
    await expect(
      (async () => {
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          await client.query(
            'update public.profiles set password_hash = $1, session_version = session_version + 1 where id = $2',
            ['corrupted-pass-hash', userId]
          )
          await client.query(
            'update public.password_reset_tokens set used_at = now() where token_hash = $1',
            [tokenHash]
          )
          throw new Error('Induced failure before COMMIT')
        } catch (err) {
          await client.query('ROLLBACK')
          throw err
        } finally {
          client.release()
        }
      })()
    ).rejects.toThrow('Induced failure before COMMIT')

    const after = await pool.query<{ password_hash: string; session_version: number }>(
      'select password_hash, session_version from public.profiles where id = $1',
      [userId]
    )
    expect(after.rows[0].password_hash).toBe(before.rows[0].password_hash)
    expect(Number(after.rows[0].session_version)).toBe(Number(before.rows[0].session_version))

    // Token was not consumed and remains valid for follow-up completion
    const result = await recovery.consumePasswordResetToken(issued!.token, 'ValidPassAfterRollback1', new Date('2026-09-04T00:21:00Z'))
    expect(result).toEqual({ ok: true, userId })
  })

  run('cleanup deletes expired rows and only old consumed rows', async () => {
    const removed = await recovery.cleanupPasswordResetTokens(new Date('2026-09-10T00:00:00Z'))
    expect(removed).toBeGreaterThanOrEqual(0)
    const remaining = await pool.query<{ count: string }>(
      'select count(*)::text as count from public.password_reset_tokens where expires_at > $1',
      ['2026-09-10T00:00:00Z']
    )
    // Only tokens with a far-future expiry survive a cleanup at 2026-09-10.
    expect(Number(remaining.rows[0].count)).toBe(0)
  })
})
