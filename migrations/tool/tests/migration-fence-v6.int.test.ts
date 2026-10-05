// tests/migration-fence-v6.int.test.ts
// C06B verification (V6): attempt real writes through the application's own
// guards while the destination is fenced, then admit it through the recorded
// publication sequence and prove the same path is allowed again. Crash points
// are simulated by stopping between transitions and asserting the durable state
// still refuses writes.
//
// This is deliberately not a mocked suite: the guards read the gate from a real
// database and the publication transitions write real receipts.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client, Pool } from 'pg'
import { parsePostgresUrl } from '@vsis/migration-tool/connections'
import { runMigrations } from '@/lib/db/migrate'
import { admitWriters, recordPublicationIntent, recordVerifiedState } from '@vsis/migration-tool/publish'
import { readWriteGate, resetWriteGateCache, setWriteGate } from '@vsis/migration-tool/gate'
import { openWriteSession } from '@vsis/migration-tool/providers/session'

const REQUIRED_ENV = ['MIGRATION_TEST_NATIVE_ADMIN_URL', 'MIGRATION_TEST_NATIVE_DB_URL'] as const
const missing = REQUIRED_ENV.filter((name) => !process.env[name])
const REQUIRE = process.env.MIGRATION_TEST_REQUIRE === '1'
const ALLOW_REMOTE = process.env.MIGRATION_TEST_ALLOW_REMOTE === '1'
const DISPOSABLE_DB_PATTERN = /^vsis_migration_c06b_[a-z0-9_]+$/

if (missing.length > 0 && REQUIRE) {
  throw new Error(`MIGRATION_TEST_REQUIRE=1 but the C06B fence gate is missing: ${missing.join(', ')}.`)
}
if (missing.length === 0) {
  const parsed = parsePostgresUrl(process.env.MIGRATION_TEST_NATIVE_DB_URL as string)
  if (!ALLOW_REMOTE && !parsed.loopback) {
    throw new Error(`MIGRATION_TEST_NATIVE_DB_URL must be loopback: ${parsed.hostname}`)
  }
  if (!DISPOSABLE_DB_PATTERN.test(parsed.database)) {
    throw new Error(`Refusing a non-disposable database: ${parsed.database}`)
  }
}

const suite = missing.length === 0 ? describe : describe.skip
const RUN_ID = 'c06b-v6-run-0001'

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

function writeSession() {
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

/** The application guards, loaded after the test backend is selected. */
async function loadGuards() {
  const rest = await import('@/app/api/_http')
  const actions = await import('@/app/actions/_shared')
  return { rest, actions }
}

suite('C06B write-attempt matrix (live)', () => {
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
    })
    const pool = new Pool({ connectionString: url, max: 2 })
    try {
      await runMigrations(pool)
    } finally {
      await pool.end()
    }

    // Point the application's own reader at this disposable database and select
    // the native backend before the db modules are imported.
    process.env.DATABASE_URL = url
    process.env.NEXT_PUBLIC_BACKEND = 'native'
    vi.resetModules()
    resetWriteGateCache()

    // A committed import receipt is the precondition for the sequence.
    const session = writeSession()
    try {
      const namespace = (await session.identity()).namespace
      await setWriteGate(session, {
        state: 'fenced', reason: 'C06B V6: fence before first receipt', actor: 'v6-operator', runId: RUN_ID,
      })
      await session.transaction(async (tx) => {
        await tx.query(
          `insert into public.migration_runs (
             run_id, bundle_id, bundle_digest, plan_digest, resolution_digest, expected_result_digest,
             source_namespace, target_namespace, application_version, schema_fingerprint, state, counts, committed_at
           ) values ($1,'bundle-1',$2,$3,$4,$5,'native:source',$7,'1.0.3',$6,'data-committed','{}'::jsonb, now())`,
          [RUN_ID, 'b'.repeat(64), 'p'.repeat(64), 'r'.repeat(64), 'e'.repeat(64), 'f'.repeat(64), namespace]
        )
      })
    } finally {
      await session.close()
    }
  }, 300_000)

  afterAll(async () => {
    if (process.env.MIGRATION_TEST_KEEP === '1') return
    // The application pool is closed, but a migration session's own connection
    // can still be open here. Dropping the database would kill it and surface as
    // an unhandled error, so the disposable database is left for the admin to
    // drop (beforeAll recreates it on every run).
    const { getPool } = await import('@/lib/db/pool')
    await getPool()
      .end()
      .catch(() => undefined)
  }, 180_000)

  it('refuses writes through the REST and Server Action surfaces while fenced, and admits them after publication', async () => {
    // Fence the destination through the operator interface.
    const gateSession = writeSession()
    try {
      await setWriteGate(gateSession, {
        state: 'fenced',
        reason: 'C06B V6: fence before apply',
        actor: 'v6-operator',
        runId: RUN_ID,
      })
    } finally {
      await gateSession.close()
    }
    resetWriteGateCache()

    vi.doMock('@/lib/auth', () => ({
      getActor: async () => ({ id: 'v6-actor', isActive: true, permissionRole: 'admin' }),
    }))
    vi.doMock('@/lib/db/types', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('@/lib/db/types')
      return {
        ...actual,
        requireActive: (actor: { isActive: boolean } | null) =>
          actor?.isActive ? { ok: true, actor } : { ok: false, error: 'You must be signed in.' },
        requireRole: (actor: { isActive: boolean } | null) =>
          actor?.isActive ? { ok: true, actor } : { ok: false, error: 'You must be signed in.' },
      }
    })
    const { rest, actions } = await loadGuards()

    const fencedWrite = await rest.requireActive(
      new Request('https://v6.test/api/data/timesheets', { method: 'POST' })
    )
    expect(fencedWrite.ok).toBe(false)
    if (!fencedWrite.ok) {
      expect(fencedWrite.response.status).toBe(503)
      const body = (await fencedWrite.response.json()) as { code?: string }
      expect(body.code).toBe('WRITERS_FENCED')
      expect(fencedWrite.response.headers.get('retry-after')).toBe('60')
    }

    const readAction = await actions.requireActiveActor()
    expect('actor' in readAction).toBe(true)
    const fencedAction = await actions.requireMutatingActiveActor()
    expect('error' in fencedAction && fencedAction.error).toContain('read-only for a data migration')

    // Reads are never fenced.
    const read = await rest.requireActive(new Request('https://v6.test/api/data/timesheets', { method: 'GET' }))
    expect(read.ok).toBe(true)


    // --- the recorded publication sequence, then the same write is admitted ---
    const publish = writeSession()
    try {
      const verified = await recordVerifiedState(publish, {
        runId: RUN_ID,
        actor: 'v6-operator',
        reason: 'V6: merged result reconciled',
      })
      expect(verified.state).toBe('verified')

      // Crash point: intent recorded, admission never happens. The destination
      // must still refuse writes.
      const intent = await recordPublicationIntent(publish, {
        runId: RUN_ID,
        actor: 'v6-operator',
        reason: 'V6: publication intent',
      })
      expect(intent.state).toBe('publication-intent')
      resetWriteGateCache()
      const stillFenced = await rest.requireActive(
        new Request('https://v6.test/api/data/timesheets', { method: 'POST' })
      )
      expect(stillFenced.ok).toBe(false)
      if (!stillFenced.ok) expect(stillFenced.response.status).toBe(503)

      const admitted = await admitWriters(publish, {
        runId: RUN_ID,
        actor: 'v6-operator',
        reason: 'V6: admit writers',
      })
      expect(admitted.state).toBe('writable')

      // Crash point: the admission committed but its response was lost. A retry
      // must confirm the durable outcome instead of reporting a state error.
      const retried = await admitWriters(publish, {
        runId: RUN_ID,
        actor: 'v6-operator',
        reason: 'V6: retry after a lost admission response',
      })
      expect(retried.state).toBe('writable')
    } finally {
      await publish.close()
    }
    resetWriteGateCache()
    const { resetAppWriteGateCache } = await import('@/lib/db/write-gate')
    resetAppWriteGateCache()

    const admittedWrite = await rest.requireActive(
      new Request('https://v6.test/api/data/timesheets', { method: 'POST' })
    )
    expect(admittedWrite.ok).toBe(true)
    const admittedAction = await actions.requireActiveActor()
    expect('actor' in admittedAction).toBe(true)

    vi.doUnmock('@/lib/db/types')
    vi.doUnmock('@/lib/auth')
    vi.resetModules()
  }, 300_000)

  it('leaves a run that stopped at publication intent fenced and retryable', async () => {
    // Crash point: intent is durable, admission never ran. The destination must
    // still refuse writes, and the durable state must let a retry proceed —
    // nothing half-applied and nothing silently published.
    const session = writeSession()
    try {
      const run = `${RUN_ID}-b`
      const namespace = (await session.identity()).namespace
      await setWriteGate(session, {
        state: 'fenced', reason: 'C06B V6: fenced for the second run', actor: 'v6-operator', runId: run,
      })
      await session.transaction(async (tx) => {
        await tx.query(
          `insert into public.migration_runs (
             run_id, bundle_id, bundle_digest, plan_digest, resolution_digest, expected_result_digest,
             source_namespace, target_namespace, application_version, schema_fingerprint, state, counts, committed_at
           ) values ($1,'bundle-2',$2,$3,$4,$5,'native:source',$7,'1.0.3',$6,'verified','{}'::jsonb, now())`,
          [run, 'b'.repeat(64), 'p'.repeat(64), 'r'.repeat(64), 'e'.repeat(64), 'f'.repeat(64), namespace]
        )
      })
      const intent = await recordPublicationIntent(session, {
        runId: run,
        actor: 'v6-operator',
        reason: 'V6: intent recorded, admission deliberately not run',
      })
      expect(intent.state).toBe('publication-intent')

      const { resetAppWriteGateCache } = await import('@/lib/db/write-gate')
      resetAppWriteGateCache()
      resetWriteGateCache()
      const gate = await readWriteGate(session)
      expect(gate).toMatchObject({ state: 'fenced', runId: run })

      // Retry the admission from the durable intent: it must complete now.
      const admitted = await admitWriters(session, {
        runId: run,
        actor: 'v6-operator',
        reason: 'V6: admission retried after the crash point',
      })
      expect(admitted.state).toBe('writable')
      resetWriteGateCache()
      expect((await readWriteGate(session))?.state).toBe('open')
    } finally {
      await session.close()
    }
  }, 300_000)

  it('enables nothing when the admission crashes mid-transaction', async () => {
    // "Crash immediately after enablement": the admission writes the receipt and
    // opens the gate in one transaction, so a crash between those statements must
    // leave the destination exactly as it was. Otherwise a restart would face an
    // uncertain enablement with no way to tell what happened.
    const session = writeSession()
    try {
      const run = `${RUN_ID}-c`
      const namespace = (await session.identity()).namespace
      await setWriteGate(session, {
        state: 'fenced', reason: 'C06B V6: fenced for the crash-point run', actor: 'v6-operator', runId: run,
      })
      await session.transaction(async (tx) => {
        await tx.query(
          `insert into public.migration_runs (
             run_id, bundle_id, bundle_digest, plan_digest, resolution_digest, expected_result_digest,
             source_namespace, target_namespace, application_version, schema_fingerprint, state, counts, committed_at
           ) values ($1,'bundle-3',$2,$3,$4,$5,'native:source',$7,'1.0.3',$6,'publication-intent','{}'::jsonb, now())`,
          [run, 'b'.repeat(64), 'p'.repeat(64), 'r'.repeat(64), 'e'.repeat(64), 'f'.repeat(64), namespace]
        )
      })

      // Delegating session whose transaction throws after the gate statement:
      // the real implementation wraps this callback in begin/commit, so the
      // throw aborts the whole admission.
      const crashing = {
        ...session,
        transaction: async (
          fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<unknown>
        ) =>
          session.transaction(async (tx) => {
            await fn({
              query: async (sql: string, params?: unknown[]) => {
                const result = await tx.query(sql, params)
                if (/insert into public\.migration_write_gate/.test(sql)) {
                  throw new Error('simulated crash after the receipt update')
                }
                return result
              },
            })
          }),
      } as unknown as ReturnType<typeof writeSession>

      await expect(
        admitWriters(crashing, { runId: run, actor: 'v6-operator', reason: 'V6: crash mid-admission' })
      ).rejects.toThrow(/simulated crash after the receipt update/)

      // Nothing was enabled: the receipt never became writable and the gate is
      // still closed for this run, which is exactly what a restart can rely on.
      const receipt = await session.query<{ state: string }>(
        'select state from public.migration_runs where run_id = $1',
        [run]
      )
      expect(receipt[0]?.state).toBe('publication-intent')
      resetWriteGateCache()
      expect(await readWriteGate(session)).toMatchObject({ state: 'fenced', runId: run })
    } finally {
      await session.close()
    }
  }, 300_000)
})
// migrations/tool/tests/migration-fence-v6.int.test.ts
