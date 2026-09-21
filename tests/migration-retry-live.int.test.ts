// Live evidence for the parked-mobile-write policy against the real retry
// history table. The rows are seeded through the same admin client the lookup
// uses, so the suite writes to whichever database the application is configured
// for and cannot accidentally assert against a different one.
//
// Runs only with MIGRATION_TEST_REQUIRE=1 and a configured admin client, and
// removes every row it seeds.
import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { computePayloadFingerprint, withIdempotency } from '@/lib/idempotency'
import { getAdminClient } from '@/lib/supabase/admin'

const REQUIRE = process.env.MIGRATION_TEST_REQUIRE === '1'
const HAS_ADMIN_ENV = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
const describeLive = REQUIRE && HAS_ADMIN_ENV ? describe : describe.skip

const stamp = Date.now()
const RUN_ID = `retry-live-${stamp}`
const NAMESPACE = 'live-retry-source'
const ACTOR = 'd4c9b1e2-0000-4000-8000-0000000000b1'
const seededKeys: string[] = []

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

// The generated Database types do not carry these migration tables yet, so the
// suite talks to them through the same structural shape the retry reader uses.
type AdminTable = {
  insert: (row: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>
  delete: () => {
    eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>
  }
}

function adminTable(table: string): AdminTable {
  return (getAdminClient() as unknown as { from: (name: string) => AdminTable }).from(table)
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
  seededKeys.push(key)
  const { error } = await adminTable('migration_retry_history').insert({
    source_namespace: NAMESPACE,
    key,
    source_actor_id: 'source-user-live',
    destination_actor_id: ACTOR,
    operation: 'delete_timesheet',
    outcome: 'committed',
    response_status: 200,
    fingerprint_kind: 'request-json-v1',
    fingerprint: computePayloadFingerprint(payload),
    created_at: new Date().toISOString(),
    run_id: RUN_ID,
  })
  if (error) throw new Error(`history seed failed: ${error.message}`)
}

describeLive('portable retry history (live)', () => {
  it('replays a stored committed outcome instead of executing', async () => {
    const key = `live-replay-${stamp}`
    const payload = { id: 'source-row-live' }
    await seedReceipt()
    await seedHistory(key, payload)

    let executions = 0
    const response = await withIdempotency(
      request(key),
      ACTOR,
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

  it('executes a key with no portable history as new work', async () => {
    const key = `live-fresh-${stamp}`
    let executions = 0
    const response = await withIdempotency(
      request(key),
      ACTOR,
      'delete_timesheet',
      { id: 'source-row-fresh' },
      async () => {
        executions += 1
        return Response.json({ data: { success: true }, error: null })
      }
    )
    expect(`${response.status}:${executions}`).toBe('200:1')
  }, 120_000)

  afterAll(async () => {
    for (const key of seededKeys) {
      await adminTable('migration_retry_history').delete().eq('key', key)
    }
    if (seededKeys.length > 0) {
      await adminTable('migration_runs').delete().eq('run_id', RUN_ID)
    }
  })
})
