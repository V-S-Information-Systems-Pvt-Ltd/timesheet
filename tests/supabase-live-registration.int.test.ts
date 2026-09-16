// tests/supabase-live-registration.int.test.ts
//
// Live verification of the public Supabase registration path:
// anonymous auth.signUp creates a pending identity, the identity cannot sign
// in until the email is confirmed, and admin confirmation unlocks login.
//
// Requires a live Supabase stack (TEST_DATABASE_URL + Supabase URL/anon key +
// service-role key). Set SUPABASE_LIVE_REQUIRED=true to turn missing
// prerequisites into a hard setup failure instead of a visible skip.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const dbUrl = process.env.TEST_DATABASE_URL || ''
const liveRequired = process.env.SUPABASE_LIVE_REQUIRED === 'true'

const MISSING_PREREQS = [
  ['TEST_DATABASE_URL', dbUrl],
  ['NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)', supabaseUrl],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', supabaseAnonKey],
  ['SUPABASE_SERVICE_ROLE_KEY', supabaseServiceRoleKey],
]
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (liveRequired && MISSING_PREREQS.length > 0) {
  // Fail loudly before Vitest can report a skipped success.
  throw new Error(
    `SUPABASE_LIVE_REQUIRED=true but required live Supabase prerequisites are missing: ${MISSING_PREREQS.join(', ')}`
  )
}

const suite = dbUrl && supabaseUrl && supabaseAnonKey && supabaseServiceRoleKey ? describe : describe.skip

const FIXTURE_DOMAIN = 'reg-fixture.test'
const FIXTURE_EMAIL = `pending@${FIXTURE_DOMAIN}`
const FIXTURE_PASSWORD = 'RegFixturePassword123!'

suite('Supabase live public registration (email confirmation required)', () => {
  const pool = new Pool({ connectionString: dbUrl })
  let admin: SupabaseClient<Database>
  let fixtureAuthUserId: string | null = null

  beforeAll(async () => {
    admin = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // The handle_new_user trigger rejects identities whose email domain is not
    // whitelisted, so the fixture domain must exist before signUp runs.
    await pool.query(
      `insert into public.whitelisted_domains (domain, auto_activate)
       values ($1, true)
       on conflict (domain) do update set auto_activate = true`,
      [FIXTURE_DOMAIN]
    )
  })

  afterAll(async () => {
    try {
      await pool.query(`delete from public.profiles where lower(email) = $1`, [FIXTURE_EMAIL])
      await pool.query(`delete from public.whitelisted_domains where domain = $1`, [FIXTURE_DOMAIN])
      if (fixtureAuthUserId) {
        await admin.auth.admin.deleteUser(fixtureAuthUserId)
      }
    } finally {
      await pool.end()
    }
  })

  it('creates a pending identity through the anonymous signup path without a session', async () => {
    const { registerUser } = await import('@/lib/auth/registration-service')
    const { supabaseRegistrationPort } = await import('@/lib/auth/registration-supabase')

    const outcome = await registerUser({ email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD }, supabaseRegistrationPort)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // Response shape stays stable; no provider token or session is exposed.
    expect(outcome.data.success).toBe(true)
    expect(outcome.data.message).toMatch(/confirm your address/i)
    expect(JSON.stringify(outcome.data)).not.toMatch(/access_token|refresh_token|session/i)

    const profile = await pool.query<{ id: string }>(
      `select id from public.profiles where lower(email) = $1`,
      [FIXTURE_EMAIL]
    )
    expect(profile.rows).toHaveLength(1)
    fixtureAuthUserId = profile.rows[0].id
  })

  it('does not claim a second pending signup created another identity', async () => {
    if (!fixtureAuthUserId) throw new Error('The first signup did not create a fixture identity.')
    const { registerUser } = await import('@/lib/auth/registration-service')
    const { supabaseRegistrationPort } = await import('@/lib/auth/registration-supabase')

    // Simulate the pre-check racing with the first request. GoTrue can return
    // the existing unconfirmed user and send another confirmation message.
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    const outcome = await registerUser(
      { email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD },
      { ...supabaseRegistrationPort, accountExists: async () => false }
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.data.userId).toBe(fixtureAuthUserId)
    expect(outcome.data.message).toMatch(/confirm your address/i)
    expect(outcome.data.message).not.toMatch(/account created/i)
  })

  it('denies password login before the email is confirmed', async () => {
    const anon = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data, error } = await anon.auth.signInWithPassword({
      email: FIXTURE_EMAIL,
      password: FIXTURE_PASSWORD,
    })
    expect(error).not.toBeNull()
    expect(data.session).toBeNull()
  })

  it('allows password login after the address is confirmed through the Admin API', async () => {
    if (!fixtureAuthUserId) {
      throw new Error('Fixture identity was not provisioned by the signup step.')
    }

    const { error: confirmErr } = await admin.auth.admin.updateUserById(fixtureAuthUserId, {
      email_confirm: true,
    })
    expect(confirmErr).toBeNull()

    const anon = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data, error } = await anon.auth.signInWithPassword({
      email: FIXTURE_EMAIL,
      password: FIXTURE_PASSWORD,
    })
    expect(error).toBeNull()
    expect(data.session).not.toBeNull()
    expect(data.user?.email?.toLowerCase()).toBe(FIXTURE_EMAIL)
    await anon.auth.signOut()
  })
})
