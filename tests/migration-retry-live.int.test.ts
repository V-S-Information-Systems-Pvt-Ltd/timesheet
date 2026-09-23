// Live evidence for the portable retry policy against the real retry history
// and mapping tables. The rows are seeded through the same admin client the
// lookup uses, so the suite writes to whichever database the application is
// configured for and cannot accidentally assert against a different one.
//
// Fail-closed setup: with MIGRATION_TEST_REQUIRE=1 a missing application
// Supabase env fails the run instead of skipping it. Every seeded row is
// deleted by key and by run id, and teardown asserts zero leftovers.
import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { computePayloadFingerprint, withIdempotency } from '@/lib/idempotency'
import { getAdminClient } from '@/lib/supabase/admin'

const REQUIRED_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const
const missing = REQUIRED_ENV.filter((name) => !process.env[name])
const REQUIRE = process.env.MIGRATION_TEST_REQUIRE === '1'
const ALLOW_REMOTE = process.env.MIGRATION_TEST_ALLOW_REMOTE === '1'

function isLoopbackUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.startsWith('127.')
  } catch {
    return false
  }
}

if (missing.length > 0 && REQUIRE) {
  throw new Error(
    `MIGRATION_TEST_REQUIRE=1 but the live retry gate is missing: ${missing.join(', ')}. ` +
      'Configure the application Supabase env (admin client) or unset the flag to skip.'
  )
}
if (REQUIRE && missing.length === 0 && !ALLOW_REMOTE && !isLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
  throw new Error(
    'MIGRATION_TEST_REQUIRE=1 refuses a non-loopback NEXT_PUBLIC_SUPABASE_URL. ' +
      'Use a disposable/local target or set MIGRATION_TEST_ALLOW_REMOTE=1 for an explicit remote-write opt-in.'
  )
}
// Ambient application credentials must never turn an ordinary unit-test run
// into a live write against whatever project happens to be configured. CI (or
// an explicit operator) opts in with MIGRATION_TEST_REQUIRE=1.
const describeLive = REQUIRE && missing.length === 0 ? describe : describe.skip

const stamp = Date.now()
const RUN_ID = `retry-live-${stamp}`
const NAMESPACE = 'live-retry-source'
const REMAPPED_ACTOR = 'd4c9b1e2-0000-4000-8000-0000000000b1'
const UNMAPPED_ACTOR = 'd4c9b1e2-0000-4000-8000-0000000000c2'
const seededHistoryKeys: string[] = []
const seededTables: Array<{ table: string; error: unknown }> = []

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

// The generated Database types do not carry these migration tables yet, so the
// suite talks to them through the same structural shape the retry reader uses.
type AdminTable = {
  insert: (row: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>
  delete: () => {
    eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>
  }
  select: () => {
    eq: (column: string, value: string) => Promise<{ data: unknown[] | null; error: { message?: string } | null }>
  }
}

function adminTable(table: string): AdminTable {
  return (getAdminClient() as unknown as { from: (name: string) => AdminTable }).from(table)
}

async function deleteRows(table: string, column: string, value: string) {
  const { error } = await adminTable(table).delete().eq(column, value)
  if (error) seededTables.push({ table, error })
}

function request(key: string) {
  return new Request('http://localhost/api/v1/test', { headers: { 'idempotency-key': key } })
}

async function seedReceipt() {
  const { error } = await adminTable('migration_runs').insert({
    run_id: RUN_ID,
    bundle_id: `bundle-${stamp}`,
    bundle_digest: digest('bundle'),
    plan_digest: digest('plan'),
    resolution_digest: digest('resolution'),
    expected_result_digest: digest('expected'),
    source_namespace: NAMESPACE,
    target_namespace: 'destination',
    application_version: 'retry-live-suite',
    schema_fingerprint: digest('schema'),
    state: 'data-committed',
  })
  if (error) throw new Error(`receipt seed failed: ${error.message}`)
}

async function seedHistory(key: string, payload: unknown) {
  const { error } = await adminTable('migration_retry_history').insert({
    source_namespace: NAMESPACE,
    key,
    source_actor_id: 'source-user-live',
    destination_actor_id: REMAPPED_ACTOR,
    operation: 'delete_timesheet',
    outcome: 'committed',
    response_status: 200,
    fingerprint_kind: 'request-json-v1',
    fingerprint: computePayloadFingerprint(payload),
    created_at: new Date().toISOString(),
    run_id: RUN_ID,
  })
  if (error) throw new Error(`history seed failed: ${error.message}`)
  seededHistoryKeys.push(key)
}

/** Marks an actor as migrated: the mapping lookup treats it as remapped. */
async function seedActorMapping() {
  const { error } = await adminTable('migration_record_map').insert({
    source_namespace: NAMESPACE,
    entity: 'profiles',
    source_id: 'source-user-live',
    destination_id: REMAPPED_ACTOR,
    run_id: RUN_ID,
  })
  if (error) throw new Error(`actor mapping seed failed: ${error.message}`)
}

describeLive('portable retry history (live)', () => {
  afterAll(async () => {
    // Delete by key and by run id, check every error, then prove zero
    // leftovers for every table this suite touched.
    for (const key of seededHistoryKeys) {
      await deleteRows('migration_retry_history', 'key', key)
    }
    await deleteRows('migration_retry_history', 'run_id', RUN_ID)
    await deleteRows('migration_record_map', 'run_id', RUN_ID)
    await deleteRows('migration_runs', 'run_id', RUN_ID)

    const leftovers: string[] = []
    for (const [table, column, value] of [
      ['migration_retry_history', 'run_id', RUN_ID],
      ['migration_record_map', 'run_id', RUN_ID],
      ['migration_runs', 'run_id', RUN_ID],
    ] as const) {
      const { data, error } = await adminTable(table).select().eq(column, value)
      if (error) throw new Error(`teardown verification read failed for ${table}: ${error.message}`)
      if ((data ?? []).length > 0) leftovers.push(`${table}: ${(data ?? []).length} rows`)
    }
    if (seededTables.length > 0) {
      throw new Error(`teardown deletes failed: ${JSON.stringify(seededTables)}`)
    }
    if (leftovers.length > 0) {
      throw new Error(`live retry suite left rows behind: ${leftovers.join('; ')}`)
    }
  })

  it('replays a stored committed outcome instead of executing', async () => {
    const key = `live-replay-${stamp}`
    const payload = { id: 'source-row-live' }
    await seedReceipt()
    await seedActorMapping()
    await seedHistory(key, payload)

    let executions = 0
    const response = await withIdempotency(
      request(key),
      REMAPPED_ACTOR,
      'delete_timesheet',
      payload,
      async () => {
        executions += 1
        return Response.json({ unexpected: true })
      }
    )
    // One picture: status, execution count and body together.
    expect(`${response.status}:${executions}:${JSON.stringify(await response.json())}`).toBe(
      '200:0:{"data":{"success":true},"error":null}'
    )
  }, 120_000)

  it('refuses a remapped actor\'s unresolvable key as manual review, never fresh work', async () => {
    // The actor is remapped (seedActorMapping) and this key reached no
    // history: C06A §2 rule 3 forbids executing it as new work.
    const key = `live-legacy-${stamp}`
    let executions = 0
    const response = await withIdempotency(
      request(key),
      REMAPPED_ACTOR,
      'delete_timesheet',
      { id: 'source-row-never-committed' },
      async () => {
        executions += 1
        return Response.json({ unexpected: true })
      }
    )
    expect(response.status).toBe(409)
    expect(executions).toBe(0)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('IDEMPOTENCY_REVIEW_REQUIRED')
  }, 120_000)

  it('keeps executing an unmapped actor\'s unknown key as fresh work', async () => {
    // No migration context exists for this actor, so the pre-migration
    // behavior is unchanged.
    const key = `live-fresh-${stamp}`
    let executions = 0
    const response = await withIdempotency(
      request(key),
      UNMAPPED_ACTOR,
      'delete_timesheet',
      { id: 'source-row-fresh' },
      async () => {
        executions += 1
        return Response.json({ data: { success: true }, error: null })
      }
    )
    expect(`${response.status}:${executions}`).toBe('200:1')
  }, 120_000)
})
