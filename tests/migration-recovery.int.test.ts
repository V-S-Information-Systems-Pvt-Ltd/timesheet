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
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { ENTITY_ORDER, canonicalizeRow, type CanonicalRow, type MigrationEntity } from '@/lib/migration/format'
import { buildPreview, type ResolvedPlan } from '@/lib/migration/merge-plan'
import { RESOLUTIONS_FORMAT, RESOLUTIONS_FORMAT_VERSION, resolvePlan } from '@/lib/migration/resolutions'
import { applyResolvedPlan } from '@/lib/migration/import'
import { resetWriteGateCache } from '@/lib/migration/gate'
import { computeSchemaFingerprint } from '@/lib/migration/schema'
import { parsePostgresUrl } from '@/lib/migration/connections'
import { openReadOnlySession, openWriteSession, type WriteSession, type WriteTransaction } from '@/lib/migration/providers/session'
import { createSupabaseAuthAdmin, type AuthAdminPort } from '@/lib/migration/providers/supabase'
import { readDeploymentSnapshot } from '@/lib/migration/providers/read'
import { makeManifest, profileRow } from './helpers/migration-fixtures'

const DOMAIN = 'recovery.test'
const SUITE_OWNER = `migration-recovery-${randomUUID()}`
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

/**
 * Decorate only the durable app-data receipt transaction. Identity journaling
 * runs in its own transaction before apply, and must receive its real result;
 * otherwise this test would conflate a lost commit response with a missing
 * identity journal entry.
 */
function loseReceiptResponse(real: WriteSession): WriteSession {
  let lost = false
  return {
    ...real,
    async transaction<T>(fn: (tx: WriteTransaction) => Promise<T>) {
      let writesReceipt = false
      const result = await real.transaction(async (tx) =>
        fn({
          query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
            if (!lost && /insert\s+into\s+public\.migration_runs\s*\(/i.test(sql)) writesReceipt = true
            return tx.query<R>(sql, params)
          },
        })
      )
      if (writesReceipt && !lost) {
        lost = true
        throw new Error('response lost after the receipt transaction committed')
      }
      return result
    },
  }
}

/**
 * Exercise the conservative uncertain-commit branch: the receipt transaction
 * really commits, its response is lost, and the first receipt lookup made by
 * the error handler is unavailable. A fresh session must later recover the
 * durable receipt and verify it without replaying the merge.
 */
function loseReceiptResponseAndHideFirstRead(real: WriteSession): WriteSession {
  let receiptResponseLost = false
  let receiptReadHidden = false
  const receiptLookup = /from\s+public\.migration_runs\s+where\s+run_id\s*=\s*\$1\b/i
  return {
    ...real,
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      if (receiptResponseLost && !receiptReadHidden && receiptLookup.test(sql)) {
        receiptReadHidden = true
        throw new Error('receipt read temporarily unavailable after the commit response was lost')
      }
      return real.query<T>(sql, params)
    },
    async transaction<T>(fn: (tx: WriteTransaction) => Promise<T>) {
      let writesReceipt = false
      const result = await real.transaction(async (tx) =>
        fn({
          query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
            if (!receiptResponseLost && /insert\s+into\s+public\.migration_runs\s*\(/i.test(sql)) writesReceipt = true
            return tx.query<R>(sql, params)
          },
        })
      )
      if (writesReceipt && !receiptResponseLost) {
        receiptResponseLost = true
        throw new Error('response lost after the receipt transaction committed')
      }
      return result
    },
  }
}

/**
 * Reject the first identity-journal insert inside the real transaction. The
 * transaction rolls back normally, while Auth creation has already happened,
 * so the production compensation path must remove that marker-owned account.
 */
function failIdentityJournalInsert(real: WriteSession): WriteSession {
  let failed = false
  return {
    ...real,
    async transaction<T>(fn: (tx: WriteTransaction) => Promise<T>) {
      return real.transaction(async (tx) =>
        fn({
          query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
            if (!failed && /insert\s+into\s+public\.migration_identity_journal\b/i.test(sql)) {
              failed = true
              throw new Error('injected identity journal failure')
            }
            return tx.query<R>(sql, params)
          },
        })
      )
    },
  }
}

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
    // The live project may retain an earlier failed fixture until its cleanup
    // pass runs. Keep the display name unique as well as the id/email so the
    // matcher cannot turn a new recovery case into a reviewed name collision.
    canonicalizeRow('profiles', profileRow({ id: options.profileId, email: options.email, name: `Recovery ${options.email}` })),
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

interface GateSnapshot {
  id: boolean
  state: 'open' | 'fenced'
  runId: string | null
  reason: string | null
  updatedAt: string
  updatedBy: string
}

/** Snapshot and fence under one row lock so an operator cannot transition the
 * gate between the read and this suite's fenced state. */
async function acquireGate(): Promise<GateSnapshot | null> {
  return withClient(async (client) => {
    await client.query('begin')
    try {
      const result = await client.query<{
        id: boolean
        state: string
        run_id: string | null
        reason: string | null
        updated_at: string
        updated_by: string
      }>(
        `select id, state, run_id, reason, updated_at::text as updated_at, updated_by
           from public.migration_write_gate where id for update`
      )
      const row = result.rows[0]
      let snapshot: GateSnapshot | null = null
      if (row) {
        if (row.state !== 'open' && row.state !== 'fenced') {
          throw new Error(`unexpected migration gate state ${row.state}`)
        }
        snapshot = {
          id: row.id,
          state: row.state,
          runId: row.run_id,
          reason: row.reason,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
        }
      }
      await client.query(
        `insert into public.migration_write_gate (id, state, run_id, reason, updated_at, updated_by)
         values (true, 'fenced', $1, $2, now(), $3)
         on conflict (id) do update
           set state = excluded.state,
               run_id = excluded.run_id,
               reason = excluded.reason,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by`,
        [SUITE_OWNER, `recovery suite ${SUITE_OWNER}: fenced for recovery cases`, SUITE_OWNER]
      )
      await client.query('commit')
      resetWriteGateCache()
      return snapshot
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    }
  })
}

async function restoreGate(snapshot: GateSnapshot | null): Promise<void> {
  try {
    await withClient(async (client) => {
      await client.query('begin')
      try {
        const current = await client.query<{
          id: boolean
          state: string
          run_id: string | null
          reason: string | null
          updated_at: string
          updated_by: string
        }>(
          `select id, state, run_id, reason, updated_at::text as updated_at, updated_by
             from public.migration_write_gate where id for update`
        )
        const row = current.rows[0]
        if (!row) {
          throw new Error('migration gate row disappeared while owned by this suite; preserving the current absence')
        }
        // A concurrent operator transition must win over restoration. The
        // unique run_id/updated_by pair proves this row is still ours.
        if (row.run_id !== SUITE_OWNER || row.updated_by !== SUITE_OWNER) {
          throw new Error(
            `migration gate is no longer owned by this suite (run_id=${row.run_id ?? 'null'}, updated_by=${row.updated_by}); preserving the concurrent state`
          )
        }
        if (snapshot) {
          await client.query(
            `update public.migration_write_gate
                set state = $1, run_id = $2, reason = $3, updated_at = $4, updated_by = $5
              where id = $6`,
            [snapshot.state, snapshot.runId, snapshot.reason, snapshot.updatedAt, snapshot.updatedBy, snapshot.id]
          )
        } else {
          await client.query('delete from public.migration_write_gate where id = $1', [row.id])
        }
        await client.query('commit')
      } catch (error) {
        await client.query('rollback').catch(() => undefined)
        throw error
      }
    })
  } finally {
    resetWriteGateCache()
  }
}

async function cleanupCase(entry: CaseEntry): Promise<string[]> {
  const errors: string[] = []
  const auth = authPort()
  let user: Awaited<ReturnType<AuthAdminPort['findUserByEmail']>> = null
  try {
    user = await auth.findUserByEmail(entry.email)
  } catch (error) {
    errors.push(`${entry.runId}: Auth lookup failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (user) {
    try {
      await auth.deleteUser(user.id)
    } catch (error) {
      errors.push(`${entry.runId}: Auth cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  try {
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
        try {
          await client.query(sql, params)
        } catch (error) {
          errors.push(`${entry.runId}: ${sql}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const leftovers: Array<[string, string, unknown[]]> = [
        ['migration_runs', 'select count(*)::int as count from public.migration_runs where run_id = $1', [entry.runId]],
        ['migration_record_map', 'select count(*)::int as count from public.migration_record_map where run_id = $1', [entry.runId]],
        ['migration_identity_journal', 'select count(*)::int as count from public.migration_identity_journal where run_id = $1', [entry.runId]],
        ['migration_record_dispositions', 'select count(*)::int as count from public.migration_record_dispositions where run_id = $1', [entry.runId]],
        ['migration_retry_history', 'select count(*)::int as count from public.migration_retry_history where run_id = $1', [entry.runId]],
        ['profiles', 'select count(*)::int as count from public.profiles where id = $1::uuid', [entry.profileId]],
        ['timesheets', 'select count(*)::int as count from public.timesheets where user_id = $1::uuid', [entry.profileId]],
      ]
      for (const [label, sql, params] of leftovers) {
        try {
          const result = await client.query<{ count: number }>(sql, params)
          if (result.rows[0]?.count !== 0) {
            errors.push(`${entry.runId}: ${label} cleanup left ${result.rows[0]?.count ?? 'unknown'} row(s)`)
          }
        } catch (error) {
          errors.push(`${entry.runId}: ${label} cleanup verification failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })
  } catch (error) {
    errors.push(`${entry.runId}: database cleanup unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    const remaining = await auth.findUserByEmail(entry.email)
    if (remaining) errors.push(`${entry.runId}: Auth cleanup left account ${remaining.id}`)
  } catch (error) {
    errors.push(`${entry.runId}: Auth cleanup verification failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return errors
}

suite('migration recovery (live, disposable services)', () => {
  const cases: CaseEntry[] = []
  let originalGate: GateSnapshot | null = null
  let gateAcquired = false
  let whitelistInserted = false
  let insertedWhitelistId: string | null = null

  beforeAll(async () => {
    originalGate = await acquireGate()
    gateAcquired = true
    // Destination signup is gated by the application's own domain whitelist; the
    // fixture domain must be allowed or Auth answers 500 for every create. Use
    // RETURNING to delete it later only when this suite actually inserted it.
    await withClient(async (client) => {
      const inserted = await client.query<{ id: string }>(
        'insert into public.whitelisted_domains (domain, auto_activate) values ($1, false) on conflict (domain) do nothing returning id',
        [DOMAIN]
      )
      whitelistInserted = inserted.rowCount === 1
      insertedWhitelistId = inserted.rows[0]?.id ?? null
    })
  }, 180_000)

  afterAll(async () => {
    const errors: string[] = []
    try {
      for (const entry of cases) errors.push(...(await cleanupCase(entry)))
    } finally {
      try {
        if (gateAcquired) await restoreGate(originalGate)
      } catch (error) {
        errors.push(`migration gate restoration failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (whitelistInserted) {
        try {
          if (!insertedWhitelistId) throw new Error('suite inserted the fixture domain but no row id was returned')
          await withClient(async (client) => {
            const removed = await client.query('delete from public.whitelisted_domains where id = $1 and domain = $2', [insertedWhitelistId, DOMAIN])
            if (removed.rowCount !== 1) throw new Error('the suite-inserted fixture domain was not removed')
          })
        } catch (error) {
          errors.push(`whitelist restoration failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    if (errors.length > 0) {
      throw new Error(`migration recovery cleanup failed after state restoration:\n${errors.join('\n')}`)
    }
  }, 300_000)

  it('C02: a dropped Auth creation response is rediscovered through the run marker', async () => {
    const suffix = randomUUID()
    const entry: CaseEntry = {
      runId: `recovery-lost-auth-${suffix}`,
      email: `lost-auth-${suffix}@${DOMAIN}`,
      profileId: randomUUID(),
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

  it('C05: a lost commit response is recovered from the durable receipt', async () => {
    const suffix = randomUUID()
    const entry: CaseEntry = {
      runId: `recovery-lost-commit-${suffix}`,
      email: `lost-commit-${suffix}@${DOMAIN}`,
      profileId: randomUUID(),
    }
    cases.push(entry)
    const resolved = await prepareMigration(entry)

    const realAuth = authPort()
    const realSession = writeSession()
    const decoratedSession = loseReceiptResponse(realSession)
    try {
      const outcome = await applyResolvedPlan({
        runId: entry.runId,
        resolvedPlan: resolved,
        session: decoratedSession,
        auth: realAuth,
      })
      expect(outcome.status).toBe('committed')
      expect(outcome.issues).toEqual([])
      expect(outcome.counts.created).toBe(1)
      expect(outcome.receipt?.state).toBe('verified')

      const state = await withClient(async (client) => {
        const profile = await client.query<{ id: string }>(
          'select id::text as id from public.profiles where id = $1::uuid',
          [entry.profileId]
        )
        const receipt = await client.query<{ state: string }>(
          'select state from public.migration_runs where run_id = $1',
          [entry.runId]
        )
        const mappings = await client.query<{ destination_id: string }>(
          'select destination_id from public.migration_record_map where run_id = $1 and entity = \'profiles\'',
          [entry.runId]
        )
        const journal = await client.query<{ action: string; destination_id: string }>(
          'select action, destination_id from public.migration_identity_journal where run_id = $1',
          [entry.runId]
        )
        return { profile: profile.rows, receipt: receipt.rows, mappings: mappings.rows, journal: journal.rows }
      })
      expect(state.profile).toEqual([{ id: entry.profileId }])
      expect(state.receipt).toEqual([{ state: 'verified' }])
      expect(state.mappings).toEqual([{ destination_id: entry.profileId }])
      expect(state.journal).toEqual([{ action: 'created', destination_id: entry.profileId }])
      expect(await realAuth.findUserByEmail(entry.email)).not.toBeNull()

      // A retry observes the durable receipt and does not open another write
      // transaction or provision a second account.
      const retry = await applyResolvedPlan({
        runId: entry.runId,
        resolvedPlan: resolved,
        session: realSession,
        auth: realAuth,
      })
      expect(retry.status).toBe('no-op')
      expect(await realAuth.findUserByEmail(entry.email)).not.toBeNull()
    } finally {
      await realSession.close()
    }
  }, 300_000)

  it('C02/C05: reports uncertain commit without cleanup when the receipt read is unavailable', async () => {
    const suffix = randomUUID()
    const entry: CaseEntry = {
      runId: `recovery-uncertain-receipt-${suffix}`,
      email: `uncertain-receipt-${suffix}@${DOMAIN}`,
      profileId: randomUUID(),
    }
    cases.push(entry)
    const resolved = await prepareMigration(entry)

    const realAuth = authPort()
    const uncertainSession = writeSession()
    const decoratedSession = loseReceiptResponseAndHideFirstRead(uncertainSession)
    let retrySession: WriteSession | null = null
    try {
      const uncertain = await applyResolvedPlan({
        runId: entry.runId,
        resolvedPlan: resolved,
        session: decoratedSession,
        auth: realAuth,
      })
      expect(uncertain.status).toBe('failed')
      expect(uncertain.issues.map((item) => item.code)).toEqual(['E_COMMIT_UNCERTAIN'])
      // E_COMMIT_UNCERTAIN is deliberately conservative: no provider identity
      // cleanup is attempted while the receipt cannot yet be read.
      expect(uncertain.identityDispositions).toBeNull()

      const committed = await withClient(async (client) => {
        const profiles = await client.query<{ id: string }>(
          'select id::text as id from public.profiles where id = $1::uuid',
          [entry.profileId]
        )
        const receipts = await client.query<{ state: string }>(
          'select state from public.migration_runs where run_id = $1',
          [entry.runId]
        )
        const mappings = await client.query<{ destination_id: string }>(
          'select destination_id from public.migration_record_map where run_id = $1 and entity = \'profiles\'',
          [entry.runId]
        )
        const journal = await client.query<{ action: string; destination_id: string }>(
          'select action, destination_id from public.migration_identity_journal where run_id = $1',
          [entry.runId]
        )
        const accounts = await client.query<{ id: string }>(
          'select id::text as id from auth.users where lower(email) = lower($1)',
          [entry.email]
        )
        return { profiles: profiles.rows, receipts: receipts.rows, mappings: mappings.rows, journal: journal.rows, accounts: accounts.rows }
      })
      expect(committed.profiles).toEqual([{ id: entry.profileId }])
      expect(committed.receipts).toEqual([{ state: 'data-committed' }])
      expect(committed.mappings).toEqual([{ destination_id: entry.profileId }])
      expect(committed.journal).toEqual([{ action: 'created', destination_id: entry.profileId }])
      expect(committed.accounts).toEqual([{ id: entry.profileId }])
      expect(await realAuth.findUserByEmail(entry.email)).not.toBeNull()

      retrySession = writeSession()
      const retry = await applyResolvedPlan({
        runId: entry.runId,
        resolvedPlan: resolved,
        session: retrySession,
        auth: realAuth,
      })
      expect(retry.status).toBe('no-op')
      expect(retry.issues).toEqual([])
      expect(retry.receipt?.state).toBe('verified')

      const verified = await withClient(async (client) => {
        const profiles = await client.query<{ id: string }>(
          'select id::text as id from public.profiles where id = $1::uuid',
          [entry.profileId]
        )
        const receipts = await client.query<{ state: string }>(
          'select state from public.migration_runs where run_id = $1',
          [entry.runId]
        )
        const mappings = await client.query<{ destination_id: string }>(
          'select destination_id from public.migration_record_map where run_id = $1 and entity = \'profiles\'',
          [entry.runId]
        )
        const journal = await client.query<{ action: string; destination_id: string }>(
          'select action, destination_id from public.migration_identity_journal where run_id = $1',
          [entry.runId]
        )
        const accounts = await client.query<{ id: string }>(
          'select id::text as id from auth.users where lower(email) = lower($1)',
          [entry.email]
        )
        return { profiles: profiles.rows, receipts: receipts.rows, mappings: mappings.rows, journal: journal.rows, accounts: accounts.rows }
      })
      expect(verified.profiles).toEqual([{ id: entry.profileId }])
      expect(verified.receipts).toEqual([{ state: 'verified' }])
      expect(verified.mappings).toEqual([{ destination_id: entry.profileId }])
      expect(verified.journal).toEqual([{ action: 'created', destination_id: entry.profileId }])
      expect(verified.accounts).toEqual([{ id: entry.profileId }])
      expect(await realAuth.findUserByEmail(entry.email)).not.toBeNull()
    } finally {
      await retrySession?.close()
      await uncertainSession.close()
    }
  }, 300_000)

  it('C04: removes a marker-owned account when identity journaling fails', async () => {
    const suffix = randomUUID()
    const entry: CaseEntry = {
      runId: `recovery-failed-journal-${suffix}`,
      email: `failed-journal-${suffix}@${DOMAIN}`,
      profileId: randomUUID(),
    }
    cases.push(entry)
    const resolved = await prepareMigration(entry)

    const realAuth = authPort()
    const realSession = writeSession()
    const decoratedSession = failIdentityJournalInsert(realSession)
    try {
      const outcome = await applyResolvedPlan({
        runId: entry.runId,
        resolvedPlan: resolved,
        session: decoratedSession,
        auth: realAuth,
      })
      expect(outcome.status).toBe('failed')
      expect(outcome.issues.map((item) => item.code)).toContain('E_IDENTITY_PROVISION')
      expect(outcome.identityDispositions?.cleanedUp).toEqual([])

      const state = await withClient(async (client) => {
        const profile = await client.query<{ id: string }>(
          'select id::text as id from public.profiles where id = $1::uuid',
          [entry.profileId]
        )
        const receipt = await client.query<{ run_id: string }>(
          'select run_id from public.migration_runs where run_id = $1',
          [entry.runId]
        )
        const journal = await client.query<{ destination_id: string }>(
          'select destination_id from public.migration_identity_journal where run_id = $1',
          [entry.runId]
        )
        return { profile: profile.rows, receipt: receipt.rows, journal: journal.rows }
      })
      expect(state.profile).toEqual([])
      expect(state.receipt).toEqual([])
      expect(state.journal).toEqual([])
      expect(await realAuth.findUserByEmail(entry.email)).toBeNull()
    } finally {
      await realSession.close()
    }
  }, 300_000)
})
