// tests/migration-provider-fence.int.test.ts
// Plan §11 amendment: the provider-level write fence must be proven with real
// write attempts, not only the durable application gate.
//
// Native leg (fail-closed env): a disposable loopback database where an app
// role's DML is revoked, the denial is proven with a real write attempt, and
// release restores the recorded grant inventory exactly.
//
// Supabase privilege stage (opt-in via MIGRATION_TEST_SUPABASE_FENCE=1, because
// it revokes grants on a shared stack): it establishes a temporary, minimal
// `authenticated` UPDATE fixture and proves that revocation blocks that REST
// write while PostgREST remains up. This is a fence-mechanism test, not
// evidence that a deployed role inventory is complete. The ingress shutdown
// stage is an operator-gated runbook procedure and is deliberately not
// automated here.
//
// Serial by design: grant changes must not interleave with anything else.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, Pool } from 'pg'
import { parsePostgresUrl, parseSupabaseAuthUrl } from '@vsis/migration-tool/connections'
import { runMigrations } from '@/lib/db/migrate'
import { createClient } from '@supabase/supabase-js'
import {
  activateFence,
  inventoryFence,
  releaseFence,
  verifyFence,
  verifySupabaseRestFence,
} from '@vsis/migration-tool/providers/fence'
import { openWriteSession } from '@vsis/migration-tool/providers/session'
import { getAdminClient } from '@/lib/supabase/admin'

const REQUIRED_ENV = ['MIGRATION_TEST_NATIVE_ADMIN_URL', 'MIGRATION_TEST_NATIVE_DB_URL'] as const
const missing = REQUIRED_ENV.filter((name) => !process.env[name])
const NATIVE_FENCE_SELECTED = process.env.MIGRATION_TEST_NATIVE_FENCE === '1'
const SUPABASE_FENCE_SELECTED = process.env.MIGRATION_TEST_SUPABASE_FENCE === '1'
const ALLOW_REMOTE = process.env.MIGRATION_TEST_ALLOW_REMOTE === '1'
const DISPOSABLE_DB_PATTERN = /^vsis_migration_(fence|c06b)_[a-z0-9_]+$/
const FENCE_ROLE = 'vsis_fence_app'

if (NATIVE_FENCE_SELECTED && missing.length > 0) {
  throw new Error(`Native provider-fence leg selected but missing: ${missing.join(', ')}.`)
}
/** Prevent admin setup/teardown from targeting a different cluster than the disposable test database. */
function assertNativeFenceTargetPair(adminUrl: string, targetUrl: string, allowRemote: boolean): void {
  const admin = parsePostgresUrl(adminUrl)
  const target = parsePostgresUrl(targetUrl)
  if (admin.loopback !== target.loopback) {
    throw new Error('Native fence admin and target URLs must both be loopback or both be remote; refusing a mixed target pair.')
  }
  if (!admin.loopback && !allowRemote) {
    throw new Error('Native fence URLs must be loopback unless MIGRATION_TEST_ALLOW_REMOTE=1 explicitly authorizes a remote disposable target.')
  }
  if (admin.hostname !== target.hostname || admin.port !== target.port) {
    throw new Error('Native fence admin and target URLs must use the same hostname and port; refusing different cluster endpoints.')
  }
  if (!DISPOSABLE_DB_PATTERN.test(target.database)) {
    throw new Error(`Refusing a non-disposable database: ${target.database}`)
  }
}

if (NATIVE_FENCE_SELECTED && missing.length === 0) {
  assertNativeFenceTargetPair(
    process.env.MIGRATION_TEST_NATIVE_ADMIN_URL as string,
    process.env.MIGRATION_TEST_NATIVE_DB_URL as string,
    ALLOW_REMOTE
  )
}

const nativeSuite = NATIVE_FENCE_SELECTED && missing.length === 0 ? describe : describe.skip

const SUPABASE_FENCE =
  SUPABASE_FENCE_SELECTED &&
  Boolean(
    process.env.MIGRATION_TEST_SUPABASE_DB_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  )
if (SUPABASE_FENCE_SELECTED && !SUPABASE_FENCE) {
  throw new Error(
    'MIGRATION_TEST_REQUIRE=1 with MIGRATION_TEST_SUPABASE_FENCE=1 but the Supabase fence env is missing: ' +
      'MIGRATION_TEST_SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.'
  )
}

/**
 * Prevent REST/Auth fixture writes from being aimed at a different deployment
 * than the database where grants are changed. Remote runs are exceptional and
 * must identify the same Supabase project from both endpoints.
 */
function assertSupabaseFenceTargetPair(restUrl: string, dbUrl: string, allowRemote: boolean): void {
  const rest = parseSupabaseAuthUrl(restUrl)
  const database = parsePostgresUrl(dbUrl)
  if (rest.loopback !== database.loopback) {
    throw new Error('Supabase fence REST and database targets must both be loopback or both be remote; refusing a mixed target pair.')
  }
  if (rest.loopback) return
  if (!allowRemote) {
    throw new Error('Supabase fence targets must be loopback unless MIGRATION_TEST_ALLOW_REMOTE=1 explicitly authorizes a verified remote run.')
  }
  if (!rest.projectRef || !database.projectRef) {
    throw new Error('Remote Supabase fence targets must expose verifiable project refs in both REST and database URLs.')
  }
  if (rest.projectRef !== database.projectRef) {
    throw new Error(`Supabase fence REST project ${rest.projectRef} does not match database project ${database.projectRef}.`)
  }
}

if (SUPABASE_FENCE) {
  assertSupabaseFenceTargetPair(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.MIGRATION_TEST_SUPABASE_DB_URL as string,
    ALLOW_REMOTE
  )
}
const supabaseSuite = SUPABASE_FENCE ? describe : describe.skip

describe('Supabase provider-fence target-pair guard', () => {
  const localRest = 'http://127.0.0.1:54321'
  const localDb = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  const remoteRest = 'https://abcdefghijklmnop.supabase.co'
  const remoteDb = 'postgresql://postgres:pw@db.abcdefghijklmnop.supabase.co:5432/postgres'

  it('accepts a fully loopback pair', () => {
    expect(() => assertSupabaseFenceTargetPair(localRest, localDb, false)).not.toThrow()
  })

  it('rejects mixed local and remote endpoints even with remote opt-in', () => {
    expect(() => assertSupabaseFenceTargetPair(remoteRest, localDb, true)).toThrow('mixed target pair')
  })

  it('requires explicit opt-in for a remote pair', () => {
    expect(() => assertSupabaseFenceTargetPair(remoteRest, remoteDb, false)).toThrow('MIGRATION_TEST_ALLOW_REMOTE=1')
  })

  it('requires the same verifiable Supabase project for a remote pair', () => {
    expect(() => assertSupabaseFenceTargetPair(remoteRest, remoteDb, true)).not.toThrow()
    expect(() => assertSupabaseFenceTargetPair(
      remoteRest,
      'postgresql://postgres:pw@db.zyxwvutsrqponmlk.supabase.co:5432/postgres',
      true
    )).toThrow('does not match')
  })
})

describe('native provider-fence target-pair guard', () => {
  const localAdmin = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'
  const localTarget = 'postgresql://vsis:vsispassword123@127.0.0.1:5432/vsis_migration_fence_local'
  const remoteAdmin = 'postgresql://postgres:pw@db.example.test:5432/postgres'
  const remoteTarget = 'postgresql://vsis:pw@db.example.test:5432/vsis_migration_fence_remote'

  it('accepts a same-cluster loopback pair with a disposable target database', () => {
    expect(() => assertNativeFenceTargetPair(localAdmin, localTarget, false)).not.toThrow()
  })

  it('rejects mixed endpoints and different remote clusters even with opt-in', () => {
    expect(() => assertNativeFenceTargetPair(remoteAdmin, localTarget, true)).toThrow('mixed target pair')
    expect(() => assertNativeFenceTargetPair(remoteAdmin, 'postgresql://vsis:pw@other.example.test:5432/vsis_migration_fence_remote', true)).toThrow('same hostname and port')
  })

  it('requires remote opt-in and a disposable target database', () => {
    expect(() => assertNativeFenceTargetPair(remoteAdmin, remoteTarget, false)).toThrow('MIGRATION_TEST_ALLOW_REMOTE=1')
    expect(() => assertNativeFenceTargetPair(remoteAdmin, 'postgresql://vsis:pw@db.example.test:5432/application', true)).toThrow('non-disposable')
  })
})

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

function nativeSession() {
  return openWriteSession({
    provider: 'native',
    role: 'destination',
    envName: 'MIGRATION_TEST',
    connectionString: process.env.MIGRATION_TEST_NATIVE_DB_URL as string,
    displayTarget: 'test',
    loopback: true,
    projectRef: null,
    applicationName: 'vsis-migration-fence-test',
  })
}

nativeSuite('provider fence (native, live)', () => {
  beforeAll(async () => {
    const adminUrl = process.env.MIGRATION_TEST_NATIVE_ADMIN_URL as string
    const url = process.env.MIGRATION_TEST_NATIVE_DB_URL as string
    const database = parsePostgresUrl(url).database
    await withClient(adminUrl, async (client) => {
      await client.query(
        'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
        [database]
      )
      await client.query(`drop database if exists "${database}"`)
      await client.query(`create database "${database}"`)
      // The fence probes a writer role; create it with exactly the grants the
      // inventory will capture.
      await client.query(`drop role if exists ${FENCE_ROLE}`)
      await client.query(`create role ${FENCE_ROLE} login password 'fence-probe-password'`)
    })
    const pool = new Pool({ connectionString: url, max: 2 })
    try {
      await runMigrations(pool)
      await pool.query(
        `grant usage on schema public to ${FENCE_ROLE};
           grant select, insert, update, delete on all tables in schema public to ${FENCE_ROLE};`
      )
    } finally {
      await pool.end()
    }
  }, 300_000)

  afterAll(async () => {
    await withClient(process.env.MIGRATION_TEST_NATIVE_ADMIN_URL as string, async (client) => {
      const database = parsePostgresUrl(process.env.MIGRATION_TEST_NATIVE_DB_URL as string).database
      await client.query(
        'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
        [database]
      )
      await client.query(`drop database if exists "${database}"`)
      await client.query(`drop role if exists ${FENCE_ROLE}`)
    })
  })

  it('revokes DML, proves denial with a real write attempt, and restores the inventory exactly', async () => {
    const session = nativeSession()
    let inventory: Awaited<ReturnType<typeof inventoryFence>> | null = null
    let activated = false
    try {
      // Before activation the probe must succeed: writes are admitted, so the
      // check fails — this proves the probe discriminates.
      const before = await verifyFence(session, [FENCE_ROLE])
      expect(before.ok, before.checks.map((check) => check.detail).join('; ')).toBe(false)
      expect(before.checks[0].detail).toContain('effective')
      expect(before.checks[0].detail).toContain('remains')

      inventory = await inventoryFence(session, 'native', [FENCE_ROLE])
      expect(inventory.grants.length).toBeGreaterThan(0)
      // Every inventoried privilege is a fenced DML privilege.
      for (const grant of inventory.grants) {
        expect(grant.privileges.every((p) => ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'].includes(p))).toBe(true)
      }

      await activateFence(session, [FENCE_ROLE])
      activated = true

      const denied = await verifyFence(session, [FENCE_ROLE])
      expect(denied.ok).toBe(true)
      expect(denied.checks[0]).toMatchObject({ surface: `sql:${FENCE_ROLE}`, ok: true })
      expect(denied.checks[0].detail).toContain('42501')

      await releaseFence(session, inventory)
      activated = false

      const restored = await inventoryFence(session, 'native', [FENCE_ROLE])
      expect(restored.grants).toEqual(inventory.grants)
      // And writes work again through the same real attempt.
      const after = await verifyFence(session, [FENCE_ROLE])
      expect(after.ok).toBe(false)
      expect(after.checks[0].detail).toContain('effective')
      expect(after.checks[0].detail).toContain('remains')
    } finally {
      if (activated && inventory) await releaseFence(session, inventory)
      await session.close()
    }
  }, 120_000)
})

supabaseSuite('provider fence (supabase privilege stage, live)', () => {
  const STAMP = Date.now()
  const PROBE_EMAIL = `fence-probe-${STAMP}@fence.test`
  const PROBE_PASSWORD = 'FenceProbe-passw0rd!'
  let insertedWhitelist = false

  function admin() {
    // server-only is aliased to a test helper, so the admin client is usable here.
    return getAdminClient()
  }

  afterAll(async () => {
    // Remove the fixture user and the whitelist row the suite inserted.
    const client = admin()
    const listed = await client.auth.admin.listUsers()
    if (listed.error) throw new Error(`probe-user cleanup list failed: ${listed.error.message}`)
    for (const user of listed.data.users) {
      if (user.email === PROBE_EMAIL) {
        const removed = await client.auth.admin.deleteUser(user.id)
        if (removed.error) throw new Error(`probe-user cleanup delete failed: ${removed.error.message}`)
      }
    }
    if (insertedWhitelist) {
      const { error } = await client.from('whitelisted_domains').delete().eq('domain', 'fence.test')
      if (error) throw new Error(`whitelist cleanup delete failed: ${error.message}`)
    }
  })

  it('revokes the controlled authenticated UPDATE fixture, proves the REST write fails while the API runs, and restores original grants', async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
    const dbUrl = process.env.MIGRATION_TEST_SUPABASE_DB_URL as string

    const session = openWriteSession({
      provider: 'supabase',
      role: 'destination',
      envName: 'MIGRATION_TEST_SUPABASE_DB_URL',
      connectionString: dbUrl,
      displayTarget: 'test',
      loopback: true,
      projectRef: null,
      applicationName: 'vsis-migration-fence-test',
    })
    let originalInventory: Awaited<ReturnType<typeof inventoryFence>> | null = null
    let fixtureInventory: Awaited<ReturnType<typeof inventoryFence>> | null = null
    let fixtureGranted = false
    let activated = false
    try {
      const client = admin()
      const { data: existing } = await client.from('whitelisted_domains').select('id').eq('domain', 'fence.test')
      if (!existing || existing.length === 0) {
        const { error } = await client
          .from('whitelisted_domains')
          .insert({ domain: 'fence.test', auto_activate: false })
        if (error) throw new Error(`whitelist seed failed: ${error.message}`)
        insertedWhitelist = true
      }

      const created = await client.auth.admin.createUser({
        email: PROBE_EMAIL,
        password: PROBE_PASSWORD,
        email_confirm: true,
      })
      if (created.error) throw new Error(`probe user creation failed: ${created.error.message}`)
      const probeUserId = created.data.user?.id
      if (!probeUserId) throw new Error('the probe user id was not returned')
      // The provider fence is testing the authenticated SQL role, not the
      // application's self-profile policy. Give this disposable account the
      // admin profile so its baseline PATCH is permitted by RLS before grants
      // are revoked; Auth still connects to PostgREST as `authenticated`.
      await withClient(dbUrl, async (db) => {
        await db.query(
          "update public.profiles set permission_role = 'admin', role = 'admin', is_active = true where id = $1::uuid",
          [probeUserId]
        )
      })

      const anon = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: signIn } = await anon.auth.signInWithPassword({ email: PROBE_EMAIL, password: PROBE_PASSWORD })
      const accessToken = signIn.session?.access_token
      if (!accessToken) throw new Error('the probe user could not sign in')

      const restUrl = supabaseUrl
      // Capture the actual local baseline first, then add only the one direct
      // grant required by this mechanism test. This does not claim the baseline
      // represents a deployable production writer inventory.
      originalInventory = await inventoryFence(session, 'supabase', ['anon', 'authenticated'])
      await session.transaction(async (tx) => {
        await tx.query('grant UPDATE on table public.profiles to "authenticated"')
      })
      fixtureGranted = true
      fixtureInventory = await inventoryFence(session, 'supabase', ['anon', 'authenticated'])
      expect(fixtureInventory.grants.some((grant) =>
        grant.role === 'authenticated' && grant.table === 'profiles' && grant.privileges.includes('UPDATE')
      )).toBe(true)

      // Before activation the controlled department no-op PATCH must succeed.
      const before = await verifySupabaseRestFence({ restUrl, accessToken, anonKey, userId: probeUserId })
      expect(before.ok, before.detail).toBe(false)
      expect(before.detail).toContain('write attempt succeeded while fenced')

      await activateFence(session, ['anon', 'authenticated'])
      activated = true

      // The API is still running: only the revoked privilege can deny this.
      const denied = await verifySupabaseRestFence({ restUrl, accessToken, anonKey, userId: probeUserId })
      expect(denied.ok).toBe(true)
      expect(denied.surface).toBe('rest:profiles')

      await releaseFence(session, fixtureInventory)
      activated = false
      const fixtureRestored = await inventoryFence(session, 'supabase', ['anon', 'authenticated'])
      expect(fixtureRestored.grants).toEqual(fixtureInventory.grants)

      const after = await verifySupabaseRestFence({ restUrl, accessToken, anonKey, userId: probeUserId })
      expect(after.ok).toBe(false)
      expect(after.detail).toContain('write attempt succeeded while fenced')
    } finally {
      // Keep this session alive through both restoration layers. If the active
      // fence recovery fails, the original baseline restoration still runs;
      // the final close runs even if either restoration fails.
      try {
        if (activated && fixtureInventory) await releaseFence(session, fixtureInventory)
      } finally {
        try {
          if (fixtureGranted && originalInventory) {
            await releaseFence(session, originalInventory)
            const originalRestored = await inventoryFence(session, 'supabase', ['anon', 'authenticated'])
            expect(originalRestored.grants).toEqual(originalInventory.grants)
          }
        } finally {
          await session.close()
        }
      }
    }
  }, 300_000)
})
// tools/migration/tests/migration-provider-fence.int.test.ts
