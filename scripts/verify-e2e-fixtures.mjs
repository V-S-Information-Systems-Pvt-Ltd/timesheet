// scripts/verify-e2e-fixtures.mjs
// Pre-build / pre-E2E fixture verification gate.
// Validates that required E2E fixture accounts exist in the database,
// have the expected account status (active vs pending), and that passwords
// can be successfully verified using the respective backend auth mechanisms.

import { promisify } from 'node:util'
import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import pg from 'pg'

const scrypt = promisify(scryptCallback)

const SCRYPT_DEFAULTS = {
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 32 * 1024 * 1024,
}

function parseHash(stored) {
  if (typeof stored !== 'string' || !stored) return null

  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$')
    if (parts.length !== 6) return null
    const [, nStr, rStr, pStr, salt, hashHex] = parts
    const N = parseInt(nStr, 10)
    const r = parseInt(rStr, 10)
    const p = parseInt(pStr, 10)
    if (!Number.isInteger(N) || N <= 1 || (N & (N - 1)) !== 0) return null
    if (!Number.isInteger(r) || r < 1) return null
    if (!Number.isInteger(p) || p < 1) return null
    if (!salt || salt.length < 16) return null
    if (!hashHex || hashHex.length < 32 || hashHex.length % 2 !== 0) return null

    try {
      const expected = Buffer.from(hashHex, 'hex')
      return { format: 'versioned', N, r, p, keylen: expected.length, salt, expected }
    } catch {
      return null
    }
  }

  if (stored.includes(':')) {
    const [salt, hashHex] = stored.split(':')
    if (!salt || !hashHex || hashHex.length % 2 !== 0) return null
    try {
      const expected = Buffer.from(hashHex, 'hex')
      return {
        format: 'legacy',
        N: SCRYPT_DEFAULTS.N,
        r: SCRYPT_DEFAULTS.r,
        p: SCRYPT_DEFAULTS.p,
        keylen: expected.length,
        salt,
        expected,
      }
    } catch {
      return null
    }
  }

  return null
}

async function verifyScryptPassword(password, stored) {
  const parsed = parseHash(stored)
  if (!parsed) return false
  try {
    const derived = await scrypt(password, parsed.salt, parsed.keylen, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: SCRYPT_DEFAULTS.maxmem,
    })
    if (derived.length !== parsed.expected.length) return false
    return timingSafeEqual(derived, parsed.expected)
  } catch {
    return false
  }
}

export async function verifyE2EFixtures(options = {}) {
  const env = options.env || process.env
  const backend = (env.NEXT_PUBLIC_BACKEND || (env.NEXT_PUBLIC_SUPABASE_URL ? 'supabase' : 'native')).toLowerCase()
  const dbUrl = env.DATABASE_URL || env.TEST_DATABASE_URL

  if (!dbUrl) {
    throw new Error('DATABASE_URL or TEST_DATABASE_URL is required to verify E2E fixtures.')
  }

  const fixtures = [
    {
      email: (env.E2E_EMAIL || env.ADMIN_EMAIL || 'admin@vsis.lk').trim().toLowerCase(),
      password: env.E2E_PASSWORD || env.ADMIN_PASSWORD || 'AdminPassword123!',
      expectedStatus: 'active',
    },
    {
      email: (env.E2E_PENDING_EMAIL || 'deactivated@vsis.lk').trim().toLowerCase(),
      password: env.E2E_PENDING_PASSWORD || 'MatrixPassword123!',
      expectedStatus: 'pending',
    },
  ]

  for (const fixture of fixtures) {
    if (!fixture.email || !fixture.password) {
      throw new Error(`E2E fixture credentials are incomplete for ${fixture.email || 'unknown fixture'}`)
    }
  }

  console.log(`\n=== Verifying E2E fixtures (${backend}) ===`)

  const pool = new pg.Pool({ connectionString: dbUrl })
  try {
    for (const fixture of fixtures) {
      const res = await pool.query(
        'select id, email, role, permission_role, hierarchy_role, is_active, password_hash from public.profiles where lower(email) = lower($1)',
        [fixture.email]
      )
      const user = res.rows[0]
      if (!user) {
        throw new Error(`Missing E2E fixture profile in database: ${fixture.email}`)
      }

      const expectedActive = fixture.expectedStatus === 'active'
      if (Boolean(user.is_active) !== expectedActive) {
        throw new Error(
          `Unexpected status for ${fixture.email}: expected ${fixture.expectedStatus} (is_active=${expectedActive}), got is_active=${user.is_active}`
        )
      }

      if (backend === 'native') {
        if (!user.password_hash) {
          throw new Error(`Missing password hash for native fixture: ${fixture.email}`)
        }
        const passwordMatches = await verifyScryptPassword(fixture.password, user.password_hash)
        if (!passwordMatches) {
          throw new Error(`Invalid password for native E2E fixture: ${fixture.email}`)
        }
        console.log(`  ✓ [native] ${fixture.email}: profile exists, status=${fixture.expectedStatus}, password valid`)
      }
    }

    if (backend === 'supabase') {
      const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY required for Supabase fixture verification.')
      }

      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })

      for (const fixture of fixtures) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: fixture.email,
          password: fixture.password,
        })
        if (error) {
          throw new Error(`Invalid credentials for Supabase E2E fixture ${fixture.email}: ${error.message}`)
        }
        if (!data?.session?.user) {
          throw new Error(`Supabase signInWithPassword returned no session for ${fixture.email}`)
        }
        console.log(`  ✓ [supabase] ${fixture.email}: profile exists, status=${fixture.expectedStatus}, authenticated successfully (ID: ${data.session.user.id})`)
      }
    }
  } finally {
    await pool.end()
  }

  console.log('E2E fixtures verified successfully.\n')
  return { success: true }
}

if (process.argv[1] && process.argv[1].endsWith('verify-e2e-fixtures.mjs')) {
  verifyE2EFixtures().catch((err) => {
    console.error('E2E fixture verification failed:', err.message)
    process.exit(1)
  })
}
