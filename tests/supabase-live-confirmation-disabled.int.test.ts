// tests/supabase-live-confirmation-disabled.int.test.ts
//
// Opt-in live regression for the unsafe provider configuration: when a
// Supabase project has email confirmation disabled, anonymous auth.signUp
// would return a session. The registration port must reject the provider
// settings before creating an identity and never report a usable account.
//
// This suite only runs against a live stack whose [auth.email]
// enable_confirmations is false, so it stays opt-in:
//
//   npx supabase stop                      # after setting enable_confirmations = false
//   npx supabase start
//   $env:SUPABASE_LIVE_CONFIRMATION_DISABLED = 'true'
//   $env:SUPABASE_LIVE_REQUIRED = 'true'
//   npx vitest run tests/supabase-live-confirmation-disabled.int.test.ts
//
// Restore enable_confirmations = true and restart the stack afterwards. The
// normal live suites (tests/supabase-live-registration.int.test.ts) cover the
// confirmation-enabled behavior.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const dbUrl = process.env.TEST_DATABASE_URL || ''
const enabled = process.env.SUPABASE_LIVE_CONFIRMATION_DISABLED === 'true'
const liveRequired = process.env.SUPABASE_LIVE_REQUIRED === 'true'

const MISSING_PREREQS = [
  ['TEST_DATABASE_URL', dbUrl],
  ['NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)', supabaseUrl],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', supabaseAnonKey],
  ['SUPABASE_SERVICE_ROLE_KEY', supabaseServiceRoleKey],
]
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (enabled && liveRequired && MISSING_PREREQS.length > 0) {
  throw new Error(
    `SUPABASE_LIVE_CONFIRMATION_DISABLED=true but required live Supabase prerequisites are missing: ${MISSING_PREREQS.join(', ')}`
  )
}

const suite =
  enabled && dbUrl && supabaseUrl && supabaseAnonKey && supabaseServiceRoleKey ? describe : describe.skip

const FIXTURE_DOMAIN = 'confirmation-disabled-fixture.test'
const FIXTURE_EMAIL = `unsafe@${FIXTURE_DOMAIN}`
const FIXTURE_PASSWORD = 'UnsafeConfigPassword123!'

suite('Supabase live registration with email confirmation disabled (opt-in)', () => {
  const pool = new Pool({ connectionString: dbUrl })
  let admin: SupabaseClient<Database>

  beforeAll(async () => {
    admin = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // handle_new_user rejects identities whose domain is not whitelisted, so
    // the fixture domain must exist before signUp runs.
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
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const leftover = (data?.users ?? []).find((u) => u.email?.toLowerCase() === FIXTURE_EMAIL)
      if (leftover) {
        await admin.auth.admin.deleteUser(leftover.id)
      }
    } finally {
      await pool.end()
    }
  })

  it('fails closed with CONFIGURATION before creating an unsafe identity', async () => {
    const { registerUser } = await import('@/lib/auth/registration-service')
    const { supabaseRegistrationPort } = await import('@/lib/auth/registration-supabase')

    const outcome = await registerUser(
      { email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD },
      supabaseRegistrationPort
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return

    expect(outcome.error.code).toBe('CONFIGURATION')
    expect(outcome.error.message).toBe('Registration is temporarily unavailable. Contact an administrator.')
    // No provider token or session may escape through the failure.
    expect(JSON.stringify(outcome)).not.toMatch(/access_token|refresh_token/)

    const profiles = await pool.query(`select id from public.profiles where lower(email) = $1`, [
      FIXTURE_EMAIL,
    ])
    expect(profiles.rows).toHaveLength(0)

    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    expect((data?.users ?? []).some((u) => u.email?.toLowerCase() === FIXTURE_EMAIL)).toBe(false)
  })
})
