// tests/email-verification.int.test.ts
// Live-Postgres coverage for lib/db/email-verification.ts: a self-signup at an
// auto-activate domain stays inactive until the mailed token is consumed, the
// token is single-use, and verification never re-activates an account an
// administrator deactivated afterwards.
//
// Skipped unless TEST_DATABASE_URL is set (see password-recovery.int.test.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

const EMAIL = 'verify.int@verify-int.example'
const DOMAIN = 'verify-int.example'

suite('native email verification store', () => {
  const pool = new Pool({ connectionString: url })
  let userId: string
  let verification: typeof import('@/lib/db/email-verification')
  let recovery: typeof import('@/lib/db/password-recovery')
  let people: typeof import('@/lib/db/native/people')

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    verification = await import('@/lib/db/email-verification')
    recovery = await import('@/lib/db/password-recovery')
    people = await import('@/lib/db/native/people')
    await pool.query('delete from public.profiles where email = $1', [EMAIL])
    await pool.query('delete from public.whitelisted_domains where domain = $1', [DOMAIN])
    await pool.query('insert into public.whitelisted_domains (domain, auto_activate) values ($1, true)', [DOMAIN])
    const user = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, is_active, email_verified_at, password_hash)
       values ($1, $1, 'user', false, null, 'scrypt$16384$8$1$abc$def')
       returning id`,
      [EMAIL]
    )
    userId = user.rows[0].id
  })

  afterAll(async () => {
    await pool.query('delete from public.profiles where email = $1', [EMAIL])
    await pool.query('delete from public.whitelisted_domains where domain = $1', [DOMAIN])
    await pool.end()
  })

  it('activates the account only once the token is consumed, and only once', async () => {
    const { token } = await verification.issueEmailVerificationToken(userId)
    const stored = await pool.query('select token_hash from public.email_verification_tokens where user_id = $1', [userId])
    expect(stored.rows.every((r) => r.token_hash !== token)).toBe(true)

    expect(await verification.consumeEmailVerificationToken(token)).toBe(true)
    const after = await pool.query('select is_active, email_verified_at from public.profiles where id = $1', [userId])
    expect(after.rows[0].is_active).toBe(true)
    expect(after.rows[0].email_verified_at).not.toBeNull()

    expect(await verification.consumeEmailVerificationToken(token)).toBe(false)
  })

  it('does not re-activate a deactivated, already-verified account', async () => {
    await pool.query('update public.profiles set is_active = false where id = $1', [userId])
    const { token } = await verification.issueEmailVerificationToken(userId)
    expect(await verification.consumeEmailVerificationToken(token)).toBe(true)
    const after = await pool.query('select is_active from public.profiles where id = $1', [userId])
    expect(after.rows[0].is_active).toBe(false)
  })

  async function resetPassword() {
    const issued = await recovery.issuePasswordResetToken(EMAIL)
    expect(await recovery.consumePasswordResetToken(issued!.token, 'NewPass1!')).toEqual({ ok: true, userId })
  }

  it('a completed password reset verifies the address and applies auto-activate', async () => {
    await pool.query('update public.profiles set is_active = false, email_verified_at = null where id = $1', [userId])
    await resetPassword()
    const after = await pool.query('select is_active, email_verified_at from public.profiles where id = $1', [userId])
    expect(after.rows[0].is_active).toBe(true)
    expect(after.rows[0].email_verified_at).not.toBeNull()
  })

  it('an admin deactivation of an unverified account survives a later link or reset', async () => {
    await pool.query('update public.profiles set is_active = true, email_verified_at = null where id = $1', [userId])
    const { token } = await verification.issueEmailVerificationToken(userId)
    const admin = { id: userId, email: 'admin@verify-int.example', role: 'admin', permission_role: 'admin', hierarchy_role: 'manager', isActive: true } as never
    expect(await people.nativePeoplePersistence.updateUserStatus(admin, userId, false)).toEqual({ error: null })

    expect(await verification.consumeEmailVerificationToken(token)).toBe(true)
    await resetPassword()
    const after = await pool.query('select is_active from public.profiles where id = $1', [userId])
    expect(after.rows[0].is_active).toBe(false)
  })

  it('a full-profile status edit also settles verification', async () => {
    await pool.query('update public.profiles set is_active = true, email_verified_at = null where id = $1', [userId])
    const admin = { id: userId, email: 'admin@verify-int.example', role: 'admin', permission_role: 'admin', hierarchy_role: 'manager', isActive: true } as never
    expect(await people.nativePeoplePersistence.updateUser(admin, userId, { isActive: false })).toEqual({ error: null })

    await resetPassword()
    const after = await pool.query('select is_active, email_verified_at from public.profiles where id = $1', [userId])
    expect(after.rows[0].is_active).toBe(false)
    expect(after.rows[0].email_verified_at).not.toBeNull()
  })
})
