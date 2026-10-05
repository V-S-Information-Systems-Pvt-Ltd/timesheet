// Loopback-only. Creates and drops its own uniquely named database; never
// resets or connects to an operator-provided source, rehearsal or target DB.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, Pool } from 'pg'
import { runMigrations } from '@/lib/db/migrate'
import { parsePostgresUrl } from '@vsis/migration-tool/connections'
import { canonicalizeRow, entitySpec, primaryKeyOf, sha256Hex, type CanonicalRow, type MigrationEntity } from '@vsis/migration-tool/format'
import { exportBundle } from '@vsis/migration-tool/export'
import { applyResolvedPlan } from '@vsis/migration-tool/import'
import { readDeploymentSnapshot } from '@vsis/migration-tool/providers/read'
import { openReadOnlySession, openWriteSession, type WriteSession, type WriteTransaction } from '@vsis/migration-tool/providers/session'
import { encodePersistedKey, PERSISTED_KEY_PREFIX } from '@vsis/migration-tool/persisted-key'
import { validateBundleDirectory } from '@vsis/migration-tool/validation'
import { dismissalRow, globalReminderRow, profileRow } from './helpers/migration-fixtures'
import { REFERENCE_RUN, emptyRows, referenceCase, referenceId, resolveReference, type ReferenceEntity } from './helpers/reference-merge'

const adminUrl = process.env.MIGRATION_REFERENCE_TEST_ADMIN_URL
if (adminUrl) {
  const parsed = parsePostgresUrl(adminUrl)
  if (!parsed.loopback || parsed.database !== 'postgres') {
    throw new Error('MIGRATION_REFERENCE_TEST_ADMIN_URL must be a loopback postgres maintenance database.')
  }
}
const suite = adminUrl ? describe : describe.skip
const database = `vsis_migration_reference_${randomUUID().replaceAll('-', '')}`
let owned = false
let admin: Client | undefined
let pool: Pool | undefined
let session: WriteSession | undefined
let connectionString: string

suite('reference merge with real immediate PostgreSQL indexes (MIGRATION_REFERENCE_TEST_ADMIN_URL)', () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    await admin.query(`create database "${database}"`)
    owned = true
    const targetUrl = new URL(adminUrl!)
    targetUrl.pathname = `/${database}`
    connectionString = targetUrl.href
    pool = new Pool({ connectionString: targetUrl.href, max: 2 })
    await runMigrations(pool, fileURLToPath(new URL('../../../db/migrations/', import.meta.url)))
    session = openWriteSession({
      provider: 'native', role: 'destination', envName: 'MIGRATION_REFERENCE_TEST',
      connectionString: targetUrl.href, displayTarget: 'owned reference merge test', loopback: true,
      projectRef: null, applicationName: 'reference-merge-test',
    })
    const indexes = await pool.query<{ indisunique: boolean; indimmediate: boolean; partial: boolean }>(
      `select indisunique, indimmediate, indpred is not null as partial from pg_index
       where indexrelid in ('public.projects_telegram_no_key'::regclass, 'public.activity_types_telegram_no_key'::regclass)`
    )
    expect(indexes.rows).toEqual([
      { indisunique: true, indimmediate: true, partial: true },
      { indisunique: true, indimmediate: true, partial: true },
    ])
  }, 60_000)

  afterAll(async () => {
    try {
      await session?.close()
      await pool?.end()
      // owned becomes true only after our CREATE succeeds. A pre-existing
      // database, even with the generated name, can never be dropped here.
      if (owned) await admin!.query(`drop database "${database}"`)
    } finally {
      await admin?.end()
    }
  })

  beforeEach(async () => {
    await pool!.query('truncate public.profiles, public.global_reminders, public.projects, public.activity_types, public.migration_runs, public.migration_record_map, public.migration_record_dispositions, public.migration_retry_history cascade')
    await pool!.query("update public.migration_write_gate set state = 'fenced', run_id = $1, reason = 'owned regression test', updated_by = 'test' where id", [REFERENCE_RUN])
  })

  async function prepare(entity: ReferenceEntity, mode: 'reuse' | 'swap' | 'duplicate') {
    const scenario = referenceCase(entity, mode)
    const columns = entitySpec(entity).columns.map((column) => column.name)
    for (const row of scenario.baseline) {
      await pool!.query(
        `insert into public.${entity} (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
        columns.map((column) => row[column])
      )
    }
    const target = await readDeploymentSnapshot(session!)
    const source = emptyRows()
    source[entity] = scenario.source
    const outcome = resolveReference(target, await session!.inspectCatalog(), source, scenario.decisions)
    return { target, outcome }
  }

  async function assertNoMetadata() {
    for (const table of ['migration_runs', 'migration_record_map', 'migration_record_dispositions', 'migration_retry_history']) {
      expect((await pool!.query(`select count(*)::int as count from public.${table}`)).rows).toEqual([{ count: 0 }])
    }
  }

  it.each([
    ['projects', 'reuse'], ['activity_types', 'reuse'], ['projects', 'swap'], ['activity_types', 'swap'],
  ] as const)('commits %s %s, preserves retained tuples and safely retries', async (entity, mode) => {
    const { outcome } = await prepare(entity, mode)
    expect(outcome.issues).toEqual([])
    const retained = () => pool!.query(`select id::text, xmin::text from public.${entity} where id = any($1::uuid[]) order by id`, [[referenceId(3), referenceId(4)]])
    const before = (await retained()).rows
    const resolved = outcome.resolvedPlan!
    const request = { runId: REFERENCE_RUN, resolvedPlan: resolved, session: session!, auth: null }
    const applied = await applyResolvedPlan(request)
    expect(applied.issues).toEqual([])
    expect(applied.status).toBe('committed')
    expect(applied.receipt?.state).toBe('verified')
    expect((await readDeploymentSnapshot(session!)).rows).toEqual(resolved.expectedResult)
    expect((await retained()).rows).toEqual(before)
    const retried = await applyResolvedPlan(request)
    expect(retried.status).toBe('no-op')
    expect(retried.issues).toEqual([])
    expect(retried.rowDriftIssues).toEqual([])
  })

  it.each(['projects', 'activity_types'] as const)('rolls back %s slot staging and metadata after receipt failure', async (entity) => {
    const { target, outcome } = await prepare(entity, 'reuse')
    expect(outcome.issues).toEqual([])
    let released = 0
    const failing: WriteSession = {
      ...session!,
      transaction: <T>(fn: (tx: WriteTransaction) => Promise<T>) => session!.transaction((tx) => fn({
        query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
          if (sql.includes('set "telegram_no" = null')) released += 1
          if (sql.startsWith('insert into public.migration_runs')) throw new Error('injected receipt failure')
          return tx.query<R>(sql, params)
        },
      })),
    }
    const result = await applyResolvedPlan({ runId: REFERENCE_RUN, resolvedPlan: outcome.resolvedPlan!, session: failing, auth: null })
    expect(result.status).toBe('failed')
    expect(result.issues).toEqual([expect.objectContaining({ code: 'E_APPLY_FAILED', message: 'injected receipt failure' })])
    expect(released).toBe(1)
    expect(await readDeploymentSnapshot(session!)).toEqual(target)
    await assertNoMetadata()
  })

  it.each(['projects', 'activity_types'] as const)('refuses duplicate final %s values without changing baseline', async (entity) => {
    const { target, outcome } = await prepare(entity, 'duplicate')
    expect(outcome.resolvedPlan).toBeNull()
    expect(outcome.issues.some((issue) => issue.code === 'E_UNIQUE_VIOLATION' && issue.message.includes('telegram_no'))).toBe(true)
    expect(await readDeploymentSnapshot(session!)).toEqual(target)
    await assertNoMetadata()
  })

  async function insertRow(entity: MigrationEntity, row: CanonicalRow) {
    const columns = entitySpec(entity).columns.map((column) => column.name)
    await pool!.query(
      `insert into public.${entity} (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
      columns.map((column) => row[column])
    )
  }

  async function prepareCompound(remapProfile = false) {
    const profile = canonicalizeRow('profiles', profileRow())
    await insertRow('profiles', profile)
    const reminders = [21, 22, 23, 24].map((n) => canonicalizeRow('global_reminders', globalReminderRow({ id: referenceId(n) })))
    for (const reminder of reminders) await insertRow('global_reminders', reminder)
    const dismissals = reminders.map((reminder) => canonicalizeRow('global_reminder_dismissals', dismissalRow({ reminder_id: reminder.id })))
    await insertRow('global_reminder_dismissals', dismissals[1])
    await insertRow('global_reminder_dismissals', dismissals[3])
    const target = await readDeploymentSnapshot(session!)
    const source = emptyRows()
    source.profiles = [{ ...profile, id: remapProfile ? referenceId(31) : profile.id }]
    source.global_reminders = reminders.slice(0, 3)
    source.global_reminder_dismissals = dismissals.slice(0, 3).map((row) => ({ ...row, user_id: source.profiles[0].id, dismissed_at: '2026-09-06T10:00:00.000000Z' }))
    const keys = source.global_reminder_dismissals.map((row) => primaryKeyOf('global_reminder_dismissals', row))
    const outcome = resolveReference(target, await session!.inspectCatalog(), source, [
      { entity: 'profiles', sourceId: String(source.profiles[0].id), destinationId: String(profile.id), action: 'map' },
      ...source.global_reminders.map((row) => ({ entity: 'global_reminders' as const, sourceId: String(row.id), destinationId: String(row.id), action: 'map' as const })),
      { entity: 'global_reminder_dismissals', sourceId: keys[0], action: 'create' },
      { entity: 'global_reminder_dismissals', sourceId: keys[1], destinationId: primaryKeyOf('global_reminder_dismissals', dismissals[1]), action: 'map', fields: { dismissed_at: 'source' } },
      { entity: 'global_reminder_dismissals', sourceId: keys[2], action: 'exclude', reason: 'synthetic exclusion' },
    ])
    expect(outcome.issues).toEqual([])
    return { target, resolved: outcome.resolvedPlan!, keys }
  }

  it.each([false, true])('persists compound rows, verifies, retries and exports provenance (remapped profile: %s)', async (remapProfile) => {
    const { resolved, keys } = await prepareCompound(remapProfile)
    const destinationKeys = keys.slice(0, 2).map((key) => resolved.idMap.global_reminder_dismissals[key])
    expect(destinationKeys).toEqual([21, 22].map((n) => `${resolved.expectedResult.profiles[0].id}\u0000${referenceId(n)}`))
    const beforeArtifact = JSON.stringify(resolved)
    const request = { runId: REFERENCE_RUN, resolvedPlan: resolved, session: session!, auth: null }
    const result = await applyResolvedPlan(request)
    expect(result.issues).toEqual([])
    expect(result.status).toBe('committed')
    expect(result.receipt?.state).toBe('verified')
    const maps = (await pool!.query('select source_id, destination_id from public.migration_record_map where entity = $1 order by source_id', ['global_reminder_dismissals'])).rows
    expect(maps).toEqual(keys.slice(0, 2).map((key, i) => ({ source_id: encodePersistedKey(key), destination_id: encodePersistedKey(destinationKeys[i]) })).sort((a, b) => a.source_id < b.source_id ? -1 : 1))
    const ordinary = (await pool!.query('select source_id, destination_id from public.migration_record_map where entity = $1', ['profiles'])).rows
    expect(ordinary).toEqual([{ source_id: String(resolved.plan.snapshot.sourceRows.profiles[0].id), destination_id: String(resolved.expectedResult.profiles[0].id) }])
    const excluded = (await pool!.query('select source_id, destination_id, action from public.migration_record_dispositions where entity = $1 and action = $2', ['global_reminder_dismissals', 'exclude'])).rows
    expect(excluded).toEqual([{ source_id: encodePersistedKey(keys[2]), destination_id: null, action: 'exclude' }])
    const current = await readDeploymentSnapshot(session!)
    expect(current.rows).toEqual({
      ...resolved.expectedResult,
      global_reminder_dismissals: [...resolved.expectedResult.global_reminder_dismissals].sort((a, b) => {
        const left = primaryKeyOf('global_reminder_dismissals', a)
        const right = primaryKeyOf('global_reminder_dismissals', b)
        return left < right ? -1 : left > right ? 1 : 0
      }),
    })
    expect(current.rows.global_reminder_dismissals).toContainEqual(expect.objectContaining({
      reminder_id: referenceId(21), dismissed_at: '2026-09-06T10:00:00.000000Z',
    }))
    const receipts = current.receipts!.filter((receipt) => receipt.entity === 'global_reminder_dismissals')
    expect(receipts.map((receipt) => receipt.sourceId).sort()).toEqual(keys.slice(0, 2).sort())
    expect(receipts.map((receipt) => receipt.destinationId).sort()).toEqual([...destinationKeys].sort())
    const retry = await applyResolvedPlan(request)
    expect(retry.status).toBe('no-op')
    expect(retry.issues).toEqual([])
    expect(retry.rowDriftIssues).toEqual([])
    expect(JSON.stringify(resolved)).toBe(beforeArtifact)

    const reader = openReadOnlySession({
      provider: 'native', role: 'source', envName: 'MIGRATION_REFERENCE_TEST', connectionString,
      displayTarget: 'owned compound export test', loopback: true, projectRef: null, applicationName: 'compound-export-test',
    })
    const workspace = mkdtempSync(join(tmpdir(), 'vsis-compound-export-'))
    const directory = join(workspace, 'bundle')
    try {
      const exported = await exportBundle(reader, { directory, runId: 'compound-export', bundleId: 'compound-export', applicationVersion: '1.0.3', batchSize: 1 })
      const validation = await validateBundleDirectory(directory)
      expect(validation.ok).toBe(true)
      const contents = readFileSync(join(directory, 'provenance.json'), 'utf8')
      const aliases = JSON.parse(contents).aliases as Array<{ entity: string; sourceId: string; destinationId: string; instanceNamespace: string }>
      const compoundAliases = aliases.filter((alias) => alias.entity === 'global_reminder_dismissals')
      expect(compoundAliases).toHaveLength(2)
      for (const [i, key] of keys.slice(0, 2).entries()) expect(compoundAliases).toContainEqual(expect.objectContaining({ sourceId: destinationKeys[i], destinationId: key, instanceNamespace: resolved.plan.sourceInstance.namespace }))
      expect(exported.manifest.provenance.sha256).toBe(sha256Hex(contents))
      expect(contents).not.toContain(PERSISTED_KEY_PREFIX)
      expect(contents).toContain('\\u0000')
    } finally {
      await reader.close()
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('rolls back compound business rows and encoded metadata when the receipt write fails', async () => {
    const { target, resolved } = await prepareCompound()
    let mappingsWritten = false
    const failing: WriteSession = {
      ...session!,
      transaction: <T>(fn: (tx: WriteTransaction) => Promise<T>) => session!.transaction((tx) => fn({
        query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
          if (sql.startsWith('insert into public.migration_record_map') && params?.[1] === 'global_reminder_dismissals') mappingsWritten = true
          if (sql.startsWith('insert into public.migration_runs')) throw new Error('injected compound receipt failure')
          return tx.query<R>(sql, params)
        },
      })),
    }
    const result = await applyResolvedPlan({ runId: REFERENCE_RUN, resolvedPlan: resolved, session: failing, auth: null })
    expect(result.issues).toEqual([expect.objectContaining({ code: 'E_APPLY_FAILED', message: 'injected compound receipt failure' })])
    expect(mappingsWritten).toBe(true)
    expect(await readDeploymentSnapshot(session!)).toEqual(target)
    await assertNoMetadata()
  })

  it.each([
    ['migration_record_map', 'source_id'], ['migration_record_map', 'destination_id'],
    ['migration_record_dispositions', 'source_id'], ['migration_record_dispositions', 'destination_id'],
  ])('fails closed on malformed %s.%s during receipt replay', async (table, column) => {
    const { resolved, keys } = await prepareCompound()
    const request = { runId: REFERENCE_RUN, resolvedPlan: resolved, session: session!, auth: null }
    expect((await applyResolvedPlan(request)).status).toBe('committed')
    await pool!.query(`update public.${table} set ${column} = $1 where entity = $2 and source_id = $3`, [`${PERSISTED_KEY_PREFIX}v1:invalid`, 'global_reminder_dismissals', encodePersistedKey(keys[0])])
    await expect(applyResolvedPlan(request)).rejects.toMatchObject({ code: 'E_PERSISTED_KEY_INVALID' })
    expect((await pool!.query('select state from public.migration_runs where run_id = $1', [REFERENCE_RUN])).rows).toEqual([{ state: 'verified' }])
  })
})
