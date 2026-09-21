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
import { ENTITY_ORDER, canonicalizeRow, type CanonicalRow, type IdentityFact, type MigrationEntity } from '@/lib/migration/format'
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
async function prepareMigration(options: {
  runId: string
  email: string
  profileId: string
  sourceIdentities?: IdentityFact[]
}): Promise<ResolvedPlan> {
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
        sourceIdentities: options.sourceIdentities ?? [
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
  sourceFixtureEmails?: string[]
  sourceFixtureIds?: string[]
}

interface RecoveryState {
  profiles: Array<{ id: string; email: string | null; name: string | null; is_active: boolean | null }>
  receipts: Array<{ state: string }>
  mappings: Array<{ destination_id: string }>
  journal: Array<{ action: string; destination_id: string }>
  accounts: Array<{ id: string }>
}

async function readCaseState(entry: CaseEntry): Promise<RecoveryState> {
  return withClient(async (client) => {
    const profiles = await client.query<RecoveryState['profiles'][number]>(
      'select id::text as id, email, name, is_active from public.profiles where id = $1::uuid',
      [entry.profileId]
    )
    const receipts = await client.query<RecoveryState['receipts'][number]>(
      'select state from public.migration_runs where run_id = $1',
      [entry.runId]
    )
    const mappings = await client.query<RecoveryState['mappings'][number]>(
      'select destination_id from public.migration_record_map where run_id = $1 and entity = \'profiles\'',
      [entry.runId]
    )
    const journal = await client.query<RecoveryState['journal'][number]>(
      'select action, destination_id from public.migration_identity_journal where run_id = $1',
      [entry.runId]
    )
    const accounts = await client.query<RecoveryState['accounts'][number]>(
      'select id::text as id from auth.users where lower(email) = lower($1)',
      [entry.email]
    )
    return {
      profiles: profiles.rows,
      receipts: receipts.rows,
      mappings: mappings.rows,
      journal: journal.rows,
      accounts: accounts.rows,
    }
  })
}

function guardAuthMutations(real: AuthAdminPort): { auth: AuthAdminPort; calls: { create: number; delete: number } } {
  const calls = { create: 0, delete: 0 }
  return {
    calls,
    auth: {
      ...real,
      createUser: async () => {
        calls.create += 1
        throw new Error('unexpected Auth create during an identity blocker')
      },
      deleteUser: async () => {
        calls.delete += 1
        throw new Error('unexpected Auth delete during an identity blocker')
      },
    },
  }
}

function guardWriteTransactions(real: WriteSession): { session: WriteSession; transactions: number } {
  const state = { transactions: 0 }
  return {
    get transactions() {
      return state.transactions
    },
    session: {
      ...real,
      async transaction<T>(_fn: (tx: WriteTransaction) => Promise<T>): Promise<T> {
        state.transactions += 1
        throw new Error('unexpected destination transaction during an identity blocker')
      },
    },
  }
}

/**
 * Capture a source identity/profile from the real local Supabase deployment,
 * then remove that source fixture before taking the destination baseline. The
 * plan retains only the captured source rows/facts, so a blocker cannot be
 * satisfied by synthetic native-shaped fixture data or by a live destination
 * collision.
 */
async function prepareCapturedIdentityPlan(options: {
  entry: CaseEntry
  mode: 'without-profile' | 'email-mismatch'
}): Promise<ResolvedPlan> {
  const { entry } = options
  const sourceAuth = authPort()
  await sourceAuth.createUser({
    id: entry.profileId,
    email: entry.email,
    name: `Source ${entry.email}`,
    runId: entry.runId,
    emailConfirmed: false,
  })

  let sourceRemoved = false
  try {
    await withClient(async (client) => {
      if (options.mode === 'without-profile') {
        const deleted = await client.query('delete from public.profiles where id = $1::uuid', [entry.profileId])
        if (deleted.rowCount !== 1) throw new Error('real Auth trigger did not create the source profile')
      } else {
        const updated = await client.query(
          'update public.profiles set email = $1 where id = $2::uuid',
          [`different-profile-${entry.profileId}@${DOMAIN}`, entry.profileId]
        )
        if (updated.rowCount !== 1) throw new Error('real Auth trigger did not create the source profile')
      }
    })

    const captureSession = readSession()
    let capturedSnapshot: Awaited<ReturnType<typeof readDeploymentSnapshot>>
    let capturedCatalog: Awaited<ReturnType<WriteSession['inspectCatalog']>>
    let capturedMigrationLedger: string[]
    try {
      capturedSnapshot = await readDeploymentSnapshot(captureSession)
      capturedCatalog = await captureSession.inspectCatalog()
      capturedMigrationLedger = await captureSession.migrationLedger()
    } finally {
      await captureSession.close()
    }
    const capturedProfile = capturedSnapshot.rows.profiles.find((row) => String(row.id) === entry.profileId)
    const capturedIdentity = capturedSnapshot.identities.find((identity) => identity.id === entry.profileId)
    if (!capturedIdentity) throw new Error('real Auth identity was not visible through the migration read boundary')
    if (options.mode === 'without-profile') {
      if (capturedProfile) throw new Error('source profile still existed in the captured no-profile case')
    } else if (!capturedProfile) {
      throw new Error('source profile was not visible in the captured email-mismatch case')
    }

    await sourceAuth.deleteUser(entry.profileId)
    sourceRemoved = true
    const targetSession = readSession()
    let targetSnapshot: Awaited<ReturnType<typeof readDeploymentSnapshot>>
    let targetCatalog: Awaited<ReturnType<WriteSession['inspectCatalog']>>
    try {
      // Apply re-reads destination provenance scoped to the reviewed source
      // namespace; build the baseline with the same filter so pre-existing
      // mappings from another source cannot make a valid plan look stale.
      targetSnapshot = await readDeploymentSnapshot(targetSession, capturedSnapshot.namespace)
      targetCatalog = await targetSession.inspectCatalog()
    } finally {
      await targetSession.close()
    }
    const sourceRows = {} as Record<MigrationEntity, CanonicalRow[]>
    for (const entity of ENTITY_ORDER) sourceRows[entity] = []
    if (capturedProfile) sourceRows.profiles = [capturedProfile]
    const sourceIdentity: IdentityFact = {
      id: capturedIdentity.id,
      email: capturedIdentity.email,
      emailConfirmed: capturedIdentity.emailConfirmed,
      hasCredential: capturedIdentity.hasCredential,
      providerIdentities: capturedIdentity.providerIdentities ?? null,
      mfaFactors: capturedIdentity.mfaFactors ?? null,
    }
    const baseManifest = makeManifest({ bundleId: `bundle-${entry.runId}` })
    const manifest = {
      ...baseManifest,
      source: {
        ...baseManifest.source,
        provider: 'supabase' as const,
        namespace: capturedSnapshot.namespace,
        runtimeFingerprint: capturedSnapshot.runtimeFingerprint,
        schemaFingerprint: computeSchemaFingerprint(capturedCatalog, 'supabase'),
        appliedMigrations: capturedMigrationLedger,
      },
    }
    const targetSchemaFingerprint = computeSchemaFingerprint(targetCatalog, 'supabase')
    const plan = buildPreview(
      {
        manifest,
        provenance: [],
        sourceRows,
        sourceIdentities: [sourceIdentity],
        target: targetSnapshot,
        targetApplicationVersion: '1.0.3',
        targetSchemaFingerprint,
      },
      { runId: entry.runId, createdAt: '2026-09-20T10:00:00.000000Z' }
    )
    const decisions = plan.unresolved.map((conflict) => ({
      entity: conflict.entity,
      sourceId: conflict.sourceId,
      action: conflict.allowedActions.includes('map') ? ('map' as const) : conflict.allowedActions[0],
      ...(conflict.destinationId ? { destinationId: conflict.destinationId } : {}),
      reason: 'recovery suite: reviewed real Supabase identity fixture',
    }))
    const outcome = resolvePlan(plan, {
      format: RESOLUTIONS_FORMAT,
      formatVersion: RESOLUTIONS_FORMAT_VERSION,
      planDigest: plan.planDigest,
      operator: { name: 'recovery-test', at: '2026-09-20T10:00:00.000000Z' },
      decisions: decisions as never,
    })
    if (!outcome.resolvedPlan) {
      throw new Error(`real identity recovery plan did not resolve: ${outcome.issues.map((issue) => issue.message).join(' | ')}`)
    }
    return outcome.resolvedPlan
  } finally {
    if (!sourceRemoved) await sourceAuth.deleteUser(entry.profileId).catch(() => undefined)
  }
}

/** Add an unrelated real Auth/profile row after this run's identity journal
 * commits. It is deliberately outside the run marker so cleanup must preserve
 * it when the apply detects destination drift. */
function injectUnrelatedDrift(real: WriteSession, auth: AuthAdminPort, drift: CaseEntry): WriteSession {
  let injected = false
  return {
    ...real,
    async transaction<T>(fn: (tx: WriteTransaction) => Promise<T>) {
      let journaled = false
      const result = await real.transaction(async (tx) =>
        fn({
          query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
            if (/insert\s+into\s+public\.migration_identity_journal\b/i.test(sql)) journaled = true
            return tx.query<R>(sql, params)
          },
        })
      )
      if (journaled && !injected) {
        injected = true
        const created = await auth.createUser({
          id: drift.profileId,
          email: drift.email,
          name: 'Unrelated Drift',
          runId: drift.runId,
          emailConfirmed: false,
        })
        if (created.id !== drift.profileId) throw new Error('unrelated drift Auth id did not match its fixture')
        await withClient(async (client) => {
          const updated = await client.query(
            `update public.profiles
                set name = $1, is_active = false
              where id = $2::uuid`,
            ['Unrelated Drift', drift.profileId]
          )
          if (updated.rowCount !== 1) throw new Error('unrelated drift profile was not created by Auth')
        })
      }
      return result
    },
  }
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
  const fixtureEmails = [...new Set([entry.email, ...(entry.sourceFixtureEmails ?? [])])]
  for (const email of fixtureEmails) {
    let user: Awaited<ReturnType<AuthAdminPort['findUserByEmail']>> = null
    try {
      user = await auth.findUserByEmail(email)
    } catch (error) {
      errors.push(`${entry.runId}: Auth lookup for ${email} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (user) {
      try {
        await auth.deleteUser(user.id)
      } catch (error) {
        errors.push(`${entry.runId}: Auth cleanup for ${email} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  const fixtureIds = [...new Set([entry.profileId, ...(entry.sourceFixtureIds ?? [])])]
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
      ]
      for (const [sql, params] of statements) {
        try {
          await client.query(sql, params)
        } catch (error) {
          errors.push(`${entry.runId}: ${sql}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      for (const profileId of fixtureIds) {
        const statements: Array<[string, string, unknown[]]> = [
          ['timesheets', 'delete from public.timesheets where user_id = $1::uuid', [profileId]],
          ['profiles', 'delete from public.profiles where id = $1::uuid', [profileId]],
        ]
        for (const [label, sql, params] of statements) {
          try {
            await client.query(sql, params)
          } catch (error) {
            errors.push(`${entry.runId}: ${label} cleanup for ${profileId}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
      const leftovers: Array<[string, string, unknown[]]> = [
        ['migration_runs', 'select count(*)::int as count from public.migration_runs where run_id = $1', [entry.runId]],
        ['migration_record_map', 'select count(*)::int as count from public.migration_record_map where run_id = $1', [entry.runId]],
        ['migration_identity_journal', 'select count(*)::int as count from public.migration_identity_journal where run_id = $1', [entry.runId]],
        ['migration_record_dispositions', 'select count(*)::int as count from public.migration_record_dispositions where run_id = $1', [entry.runId]],
        ['migration_retry_history', 'select count(*)::int as count from public.migration_retry_history where run_id = $1', [entry.runId]],
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
      for (const profileId of fixtureIds) {
        const checks: Array<[string, string, unknown[]]> = [
          ['profiles', 'select count(*)::int as count from public.profiles where id = $1::uuid', [profileId]],
          ['timesheets', 'select count(*)::int as count from public.timesheets where user_id = $1::uuid', [profileId]],
        ]
        for (const [label, sql, params] of checks) {
          try {
            const result = await client.query<{ count: number }>(sql, params)
            if (result.rows[0]?.count !== 0) {
              errors.push(`${entry.runId}: ${label} cleanup for ${profileId} left ${result.rows[0]?.count ?? 'unknown'} row(s)`)
            }
          } catch (error) {
            errors.push(`${entry.runId}: ${label} cleanup verification for ${profileId} failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
    })
  } catch (error) {
    errors.push(`${entry.runId}: database cleanup unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  for (const email of fixtureEmails) {
    try {
      const remaining = await auth.findUserByEmail(email)
      if (remaining) errors.push(`${entry.runId}: Auth cleanup left account ${remaining.id} for ${email}`)
    } catch (error) {
      errors.push(`${entry.runId}: Auth cleanup verification for ${email} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
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

  it('C04: blocks a source Auth identity without a profile before destination mutation', async () => {
    const suffix = randomUUID()
    const entry: CaseEntry = {
      runId: `recovery-identity-without-profile-${suffix}`,
      email: `identity-without-profile-${suffix}@${DOMAIN}`,
      profileId: randomUUID(),
      sourceFixtureEmails: [`identity-without-profile-${suffix}@${DOMAIN}`],
      sourceFixtureIds: [],
    }
    cases.push(entry)
    const resolved = await prepareCapturedIdentityPlan({ entry, mode: 'without-profile' })
    const realAuth = authPort()
    const realSession = writeSession()
    const authGuard = guardAuthMutations(realAuth)
    const writeGuard = guardWriteTransactions(realSession)
    try {
      const outcome = await applyResolvedPlan({
        runId: entry.runId,
        resolvedPlan: resolved,
        session: writeGuard.session,
        auth: authGuard.auth,
      })
      expect(outcome.status).toBe('failed')
      expect(outcome.issues.map((item) => item.code)).toEqual(['E_IDENTITY_WITHOUT_PROFILE'])
      expect(outcome.identityProvisions).toEqual([])
      expect(authGuard.calls).toEqual({ create: 0, delete: 0 })
      expect(writeGuard.transactions).toBe(0)
      const state = await readCaseState(entry)
      expect(state.profiles).toEqual([])
      expect(state.receipts).toEqual([])
      expect(state.mappings).toEqual([])
      expect(state.journal).toEqual([])
      expect(state.accounts).toEqual([])
    } finally {
      await realSession.close()
    }
  }, 300_000)

  it('C04: blocks a source Auth/profile email mismatch before destination mutation', async () => {
    const suffix = randomUUID()
    const entry: CaseEntry = {
      runId: `recovery-identity-email-mismatch-${suffix}`,
      email: `identity-email-mismatch-${suffix}@${DOMAIN}`,
      profileId: randomUUID(),
      sourceFixtureEmails: [`identity-email-mismatch-${suffix}@${DOMAIN}`],
      sourceFixtureIds: [],
    }
    cases.push(entry)
    const resolved = await prepareCapturedIdentityPlan({ entry, mode: 'email-mismatch' })
    const realAuth = authPort()
    const realSession = writeSession()
    const authGuard = guardAuthMutations(realAuth)
    const writeGuard = guardWriteTransactions(realSession)
    try {
      const outcome = await applyResolvedPlan({
        runId: entry.runId,
        resolvedPlan: resolved,
        session: writeGuard.session,
        auth: authGuard.auth,
      })
      expect(outcome.status).toBe('failed')
      expect(outcome.issues.map((item) => item.code)).toEqual(['E_IDENTITY_EMAIL_MISMATCH'])
      expect(outcome.identityProvisions).toEqual([])
      expect(authGuard.calls).toEqual({ create: 0, delete: 0 })
      expect(writeGuard.transactions).toBe(0)
      const state = await readCaseState(entry)
      expect(state.profiles).toEqual([])
      expect(state.receipts).toEqual([])
      expect(state.mappings).toEqual([])
      expect(state.journal).toEqual([])
      expect(state.accounts).toEqual([])
    } finally {
      await realSession.close()
    }
  }, 300_000)

  it('C04: detects unrelated post-provisioning drift and preserves that account', async () => {
    const suffix = randomUUID()
    const entry: CaseEntry = {
      runId: `recovery-destination-drift-${suffix}`,
      email: `destination-drift-${suffix}@${DOMAIN}`,
      profileId: randomUUID(),
    }
    const drift: CaseEntry = {
      runId: `recovery-unrelated-drift-${suffix}`,
      email: `unrelated-drift-${suffix}@${DOMAIN}`,
      profileId: randomUUID(),
    }
    cases.push(entry, drift)
    const resolved = await prepareMigration(entry)
    const auth = authPort()
    const realSession = writeSession()
    const decoratedSession = injectUnrelatedDrift(realSession, auth, drift)
    try {
      const outcome = await applyResolvedPlan({
        runId: entry.runId,
        resolvedPlan: resolved,
        session: decoratedSession,
        auth,
      })
      expect(outcome.status).toBe('failed')
      expect(outcome.issues.map((item) => item.code)).toContain('E_DESTINATION_DRIFT')
      expect(outcome.identityDispositions?.cleanedUp).toEqual([entry.profileId])

      const migrated = await readCaseState(entry)
      expect(migrated.profiles).toEqual([])
      expect(migrated.receipts).toEqual([])
      expect(migrated.mappings).toEqual([])
      expect(migrated.journal).toEqual([])
      expect(migrated.accounts).toEqual([])

      const preserved = await readCaseState(drift)
      expect(preserved.profiles).toEqual([
        { id: drift.profileId, email: drift.email, name: 'Unrelated Drift', is_active: false },
      ])
      expect(preserved.receipts).toEqual([])
      expect(preserved.mappings).toEqual([])
      expect(preserved.journal).toEqual([])
      expect(preserved.accounts).toEqual([{ id: drift.profileId }])
      expect(await auth.findUserByEmail(drift.email)).not.toBeNull()
    } finally {
      await realSession.close()
    }
  }, 300_000)
})
