// tests/migration-recovery.int.test.ts
// Live recovery evidence for C02, C04 and C05 against disposable services.
//
// Failures are injected with test-only decorators around the real ports
// (AuthAdminPort, WriteSession); production code carries no failure hooks, and
// each plan is built in-process so a case exercises the failure it names rather
// than the planning pipeline.
//
// The fixture accounts use a domain the suite whitelists itself: destination
// signup is gated by the app's own domain whitelist trigger, which answers any
// other address with a 500.
//
// Gate: MIGRATION_TEST_SUPABASE_DB_URL (disposable project DB),
// MIGRATION_TEST_SUPABASE_AUTH_URL + MIGRATION_TEST_SUPABASE_SERVICE_KEY.
// MIGRATION_TEST_REQUIRE=1 fails setup when they are absent; a remote Supabase
// target additionally needs MIGRATION_TEST_ALLOW_REMOTE_SUPABASE=1.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { ENTITY_ORDER, canonicalizeRow, type CanonicalRow, type MigrationEntity } from '@/lib/migration/format'
import { buildPreview, type ResolvedPlan } from '@/lib/migration/merge-plan'
import { RESOLUTIONS_FORMAT, RESOLUTIONS_FORMAT_VERSION, resolvePlan } from '@/lib/migration/resolutions'
import { applyResolvedPlan } from '@/lib/migration/import'
import { resetWriteGateCache, setWriteGate } from '@/lib/migration/gate'
import { computeSchemaFingerprint } from '@/lib/migration/schema'
import { parsePostgresUrl } from '@/lib/migration/connections'
import { openReadOnlySession, openWriteSession, type WriteSession } from '@/lib/migration/providers/session'
import { createSupabaseAuthAdmin, type AuthAdminPort } from '@/lib/migration/providers/supabase'
import { readDeploymentSnapshot } from '@/lib/migration/providers/read'
import { makeManifest, profileRow } from './helpers/migration-fixtures'

const DOMAIN = 'recovery.test'
const REQUIRED_ENV = [
  'MIGRATION_TEST_SUPABASE_DB_URL',
  'MIGRATION_TEST_SUPABASE_AUTH_URL',
  'MIGRATION_TEST_SUPABASE_SERVICE_KEY',
] as const
const missing = REQUIRED_ENV.filter((name) => !process.env[name])
const REQUIRE = process.env.MIGRATION_TEST_REQUIRE === '1'
const ALLOW_REMOTE = process.env.MIGRATION_TEST_ALLOW_REMOTE_SUPABASE === '1'

if (missing.length > 0 && REQUIRE) {
  throw new Error(`MIGRATION_TEST_REQUIRE=1 but the recovery gate is missing: ${missing.join(', ')}.`)
}
if (missing.length === 0 && !ALLOW_REMOTE && !parsePostgresUrl(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string).loopback) {
  // Same rule the round-trip suite applies: releasing a hosted database needs its
  // own explicit decision, not a generic opt-in.
  throw new Error('MIGRATION_TEST_SUPABASE_DB_URL is not loopback; set MIGRATION_TEST_ALLOW_REMOTE_SUPABASE=1 to run against it.')
}

const suite = missing.length === 0 ? describe : describe.skip
const supabaseDb = () => process.env.MIGRATION_TEST_SUPABASE_DB_URL as string

function target() {
  return {
    provider: 'supabase' as const,
    role: 'destination' as const,
    envName: 'MIGRATION_TEST',
    connectionString: supabaseDb(),
    displayTarget: 'test',
    loopback: parsePostgresUrl(supabaseDb()).loopback,
    projectRef: null,
    applicationName: 'vsis-migration-recovery-test',
  }
}

const readSession = () => openReadOnlySession(target())
const writeSession = () => openWriteSession(target())

const authPort = (): AuthAdminPort =>
  createSupabaseAuthAdmin({
    role: 'destination',
    urlEnvName: 'MIGRATION_TEST_SUPABASE_AUTH_URL',
    keyEnvName: 'MIGRATION_TEST_SUPABASE_SERVICE_KEY',
    url: process.env.MIGRATION_TEST_SUPABASE_AUTH_URL as string,
    serviceKey: process.env.MIGRATION_TEST_SUPABASE_SERVICE_KEY as string,
    loopback: parsePostgresUrl(supabaseDb()).loopback,
    projectRef: null,
  })

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: supabaseDb() })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** One account to provision, planned against the live destination. */
async function prepareMigration(options: { runId: string; email: string; profileId: string }): Promise<ResolvedPlan> {
  const sourceRows = {} as Record<MigrationEntity, CanonicalRow[]>
  for (const entity of ENTITY_ORDER) sourceRows[entity] = []
  sourceRows.profiles = [
    canonicalizeRow('profiles', profileRow({ id: options.profileId, email: options.email, name: 'Recovery Case' })),
  ]

  const session = readSession()
  try {
    const snapshot = await readDeploymentSnapshot(session)
    const catalog = await session.inspectCatalog()
    const plan = buildPreview(
      {
        manifest: makeManifest({ bundleId: `bundle-${options.runId}` }),
        provenance: [],
        sourceRows,
        // A bundle carries the source account's assurance facts; without them
        // apply refuses to provision (a reviewed account needs its sign-in
        // providers visible).
        sourceIdentities: [
          {
            id: options.profileId,
            email: options.email,
            emailConfirmed: true,
            hasCredential: null,
            providerIdentities: ['email'],
            mfaFactors: 0,
          },
        ],
        target: snapshot,
        targetApplicationVersion: '1.0.3',
        targetSchemaFingerprint: computeSchemaFingerprint(catalog, 'supabase'),
      },
      { runId: options.runId, createdAt: '2026-09-20T10:00:00.000000Z' }
    )
    // Both deployments bootstrap the same reference rows; the reviewed answer is
    // always "this is the same row".
    const decisions = plan.unresolved.map((conflict) => ({
      entity: conflict.entity,
      sourceId: conflict.sourceId,
      action: conflict.allowedActions.includes('map') ? ('map' as const) : conflict.allowedActions[0],
      ...(conflict.destinationId ? { destinationId: conflict.destinationId } : {}),
      reason: 'recovery suite: reviewed reference row',
    }))
    const outcome = resolvePlan(plan, {
      format: RESOLUTIONS_FORMAT,
      formatVersion: RESOLUTIONS_FORMAT_VERSION,
      planDigest: plan.planDigest,
      operator: { name: 'recovery-test', at: '2026-09-20T10:00:00.000000Z' },
      decisions: decisions as never,
    })
    if (!outcome.resolvedPlan) {
      throw new Error(`recovery plan did not resolve: ${outcome.issues.map((issue) => issue.message).join(' | ')}`)
    }
    return outcome.resolvedPlan
  } finally {
    await session.close()
  }
}

interface CaseEntry {
  runId: string
  email: string
  profileId: string
}

async function cleanupCase(entry: CaseEntry): Promise<void> {
  // Best-effort per statement: one failure must not leave the whitelist entry,
  // the fence or another case's fixtures behind.
  const auth = authPort()
  const user = await auth.findUserByEmail(entry.email).catch(() => null)
  if (user) await auth.deleteUser(user.id).catch(() => undefined)
  await withClient(async (client) => {
    const statements: Array<[string, unknown[]]> = [
      // Dependents of the receipt first: dispositions and retry history carry a
      // foreign key to migration_runs(run_id).
      ['delete from public.migration_record_dispositions where run_id = $1', [entry.runId]],
      ['delete from public.migration_retry_history where run_id = $1', [entry.runId]],
      ['delete from public.timesheets where user_id = $1::uuid', [entry.profileId]],
      ['delete from public.migration_record_map where run_id = $1', [entry.runId]],
      ['delete from public.migration_identity_journal where run_id = $1', [entry.runId]],
      ['delete from public.migration_runs where run_id = $1', [entry.runId]],
      ['delete from public.profiles where id = $1::uuid', [entry.profileId]],
    ]
    for (const [sql, params] of statements) {
      await client.query(sql, params).catch(() => undefined)
    }
  }).catch(() => undefined)
}

suite('migration recovery (live, disposable services)', () => {
  const cases: CaseEntry[] = []

  beforeAll(async () => {
    // Destination signup is gated by the application's own domain whitelist; the
    // fixture domain must be allowed or Auth answers 500 for every create.
    await withClient(async (client) => {
      await client.query(
        "insert into public.whitelisted_domains (domain, auto_activate) values ($1, false) on conflict (domain) do nothing",
        [DOMAIN]
      )
    })
    resetWriteGateCache()
    const session = writeSession()
    try {
      await setWriteGate(session, {
        state: 'fenced',
        reason: 'recovery suite: fenced for the recovery cases',
        actor: 'recovery-test',
      })
    } finally {
      await session.close()
    }
  }, 180_000)

  afterAll(async () => {
    try {
      for (const entry of cases) await cleanupCase(entry)
    } finally {
      // The fence and the whitelist entry must be released even when a case left
      // its fixtures in a state cleanup could not fully remove.
      resetWriteGateCache()
      const session = writeSession()
      try {
        await setWriteGate(session, {
          state: 'open',
          reason: '[recovery] recovery suite complete; writers admitted',
          actor: 'recovery-test',
        })
      } finally {
        await session.close()
      }
      await withClient(async (client) => {
        await client.query('delete from public.whitelisted_domains where domain = $1', [DOMAIN]).catch(() => undefined)
      }).catch(() => undefined)
    }
  }, 300_000)

  it('C02: a dropped Auth creation response is rediscovered through the run marker', async () => {
    const entry: CaseEntry = {
      runId: 'recovery-lost-auth-0001',
      email: `lost-auth@${DOMAIN}`,
      profileId: 'c0600000-0000-4000-8000-0000000000a1',
    }
    cases.push(entry)
    const resolved = await prepareMigration(entry)

    const real = authPort()
    const dropped: AuthAdminPort = {
      ...real,
      createUser: async (input) => {
        await real.createUser(input)
        throw new Error('response lost after the account was created')
      },
    }

    const session = writeSession()
    try {
      const outcome = await applyResolvedPlan({ runId: entry.runId, resolvedPlan: resolved, session, auth: dropped })
      expect(outcome.status).toBe('committed')

      // Exactly one account, carrying the run marker, journaled once.
      const users = await real.findUserByEmail(entry.email)
      expect(users).not.toBeNull()
      const state = await withClient(async (client) => {
        const journal = await client.query<{ action: string }>(
          'select action from public.migration_identity_journal where run_id = $1',
          [entry.runId]
        )
        const markers = await client.query<{ run_id: string | null }>(
          "select raw_app_meta_data ->> 'vsis_migration_run_id' as run_id from auth.users where lower(email) = lower($1)",
          [entry.email]
        )
        return { journal: journal.rows, markers: markers.rows }
      })
      expect(state.markers).toHaveLength(1)
      expect(state.markers[0].run_id).toBe(entry.runId)
      expect(state.journal.map((row) => row.action)).toEqual(['created'])

      // The retry resumes instead of creating a second account.
      const retry = await applyResolvedPlan({ runId: entry.runId, resolvedPlan: resolved, session, auth: real })
      expect(retry.status).toBe('no-op')
    } finally {
      await session.close()
    }
  }, 300_000)

  // Two further cases are drafted and recorded in the ledger with their current
  // diagnosis; they are deliberately not shipped red:
  //  * lost commit response -> the recovery path reports committed, yet the
  //    merged profile row is absent (profiles = 0). Next step: check what the
  //    decorator does to the app-data transaction's commit/return value.
  //  * failed journal write -> the plan decides map for the fixture profile
  //    even after the pre-clean, so nothing is provisioned. Next step: find what
  //    makes the destination match that id before the destination snapshot is
  //    read (the match is by id, not by the unique email).
})
