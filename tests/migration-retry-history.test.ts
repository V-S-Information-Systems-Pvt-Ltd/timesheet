import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computePayloadFingerprint, withIdempotency } from '@/lib/idempotency'

const state = vi.hoisted(() => ({
  imported: [] as Array<Record<string, unknown>>,
  mappings: [] as Array<{ source_namespace: string; entity: string; source_id: string; destination_id: string }>,
  local: null as null | Record<string, unknown>,
  effectFingerprint: null as string | null,
  effectPayload: null as unknown,
  freshKeyAdmitted: false,
  claimExisting: false,
}))

vi.mock('@/lib/backend/config', () => ({ IS_NATIVE: true, IS_SUPABASE: false }))
vi.mock('@/lib/idempotency-fresh-key', () => ({
  admitsFreshKey: vi.fn(async () => state.freshKeyAdmitted),
}))
vi.mock('@/lib/db/pool', () => ({
  query: vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('from public.migration_retry_history')) return state.imported
    if (sql.includes("entity = 'profiles' and destination_id")) {
      return state.mappings
        .filter((row) => row.entity === 'profiles' && row.destination_id === params[0])
        .map((row) => ({ source_namespace: row.source_namespace, source_id: row.source_id }))
    }
    if (sql.includes('from public.migration_record_map') && sql.includes('destination_id = any')) {
      const [namespace, ids] = params as [string, string[]]
      return state.mappings.filter((row) => row.source_namespace === namespace && ids.includes(row.destination_id))
    }
    if (sql.includes('from public.migration_record_map') && sql.includes('source_id = any')) {
      const [namespace, ids] = params as [string, string[]]
      return state.mappings.filter((row) => row.source_namespace === namespace && ids.includes(row.source_id))
    }
    if (sql.includes('idempotency_effect_fingerprint')) {
      state.effectPayload = JSON.parse(String(params[1]))
      return state.effectFingerprint ? [{ fingerprint: state.effectFingerprint }] : []
    }
    if (sql.includes('select payload_fingerprint')) return state.local ? [state.local] : []
    if (sql.includes('insert into public.idempotency_keys')) return state.claimExisting ? [] : [{ key: params[0] }]
    return []
  }),
  transaction: vi.fn(),
}))

function request(key: string) {
  return new Request('http://localhost/api/v1/test', { headers: { 'idempotency-key': key } })
}

describe('portable migration retry history', () => {
  beforeEach(() => {
    state.imported = []
    state.mappings = []
    state.local = null
    state.effectFingerprint = null
    state.effectPayload = null
    state.freshKeyAdmitted = false
    state.claimExisting = false
  })

  it('replays one exact imported request history without executing', async () => {
    const payload = { id: 'source-row' }
    state.imported = [{
      source_namespace: 'source-a', source_actor_id: 'source-user', outcome: 'committed',
      response_status: 200, fingerprint_kind: 'request-json-v1',
      fingerprint: computePayloadFingerprint(payload),
    }]
    let executions = 0
    const response = await withIdempotency(
      request('portable-1'), 'destination-user', 'delete_timesheet', payload,
      async () => { executions += 1; return Response.json({ unexpected: true }) }
    )
    expect(response.status).toBe(200)
    expect(executions).toBe(0)
    expect(await response.json()).toEqual({ data: { success: true }, error: null })
  })

  it('rejects an exact imported and destination-local collision as ambiguous', async () => {
    const payload = { id: 'row-1' }
    const fingerprint = computePayloadFingerprint(payload)
    state.imported = [{
      source_namespace: 'source-a', source_actor_id: 'source-user', outcome: 'committed',
      response_status: 200, fingerprint_kind: 'request-json-v1', fingerprint,
    }]
    state.local = {
      payload_fingerprint: fingerprint, response_status: 200, response_payload: {}, committed_unknown: false,
    }
    const response = await withIdempotency(
      request('portable-2'), 'destination-user', 'delete_timesheet', payload,
      async () => Response.json({ unexpected: true })
    )
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('IDEMPOTENCY_NAMESPACE_AMBIGUOUS')
  })

  it('does not let imported success hide a destination-local unknown commit', async () => {
    const payload = { id: 'row-1' }
    state.imported = [{
      source_namespace: 'source-a', source_actor_id: 'source-user', outcome: 'committed',
      response_status: 200, fingerprint_kind: 'request-json-v1',
      fingerprint: computePayloadFingerprint(payload),
    }]
    state.local = {
      payload_fingerprint: computePayloadFingerprint(payload), response_status: 0,
      response_payload: {}, committed_unknown: true,
    }

    const response = await withIdempotency(
      request('portable-local-unknown'), 'destination-user', 'delete_timesheet', payload,
      async () => Response.json({ unexpected: true })
    )

    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('IDEMPOTENCY_COMMIT_UNKNOWN')
  })

  it('does not let imported success hide a destination-local in-flight claim', async () => {
    const payload = { id: 'row-1' }
    state.imported = [{
      source_namespace: 'source-a', source_actor_id: 'source-user', outcome: 'committed',
      response_status: 200, fingerprint_kind: 'request-json-v1',
      fingerprint: computePayloadFingerprint(payload),
    }]
    state.local = {
      payload_fingerprint: computePayloadFingerprint(payload), response_status: 0,
      response_payload: {}, committed_unknown: false,
    }

    const response = await withIdempotency(
      request('portable-local-in-flight'), 'destination-user', 'delete_timesheet', payload,
      async () => Response.json({ unexpected: true })
    )

    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('IDEMPOTENCY_IN_FLIGHT')
  })

  it.each([
    ['create_timesheet', { projectId: 'source-project', activityTypeId: 'source-activity' }],
    ['update_timesheet', { id: 'source-row', projectId: 'source-project', activityTypeId: 'source-activity' }],
    ['delete_timesheet', { id: 'source-row' }],
  ])(
    'translates uncommitted %s payloads whose IDs are all remapped source IDs (C06A §1a)',
    async (operation, payload) => {
      state.mappings = [
        { source_namespace: 'source-a', entity: 'profiles', source_id: 'source-user', destination_id: 'destination-user' },
        { source_namespace: 'source-a', entity: 'projects', source_id: 'source-project', destination_id: 'destination-project' },
        { source_namespace: 'source-a', entity: 'activity_types', source_id: 'source-activity', destination_id: 'destination-activity' },
        { source_namespace: 'source-a', entity: 'timesheets', source_id: 'source-row', destination_id: 'destination-row' },
      ]
      let executions = 0
      const response = await withIdempotency(
        request(`uncommitted-${operation}`), 'destination-user', operation, payload,
        async () => { executions += 1; return Response.json({ ok: true }) }
      )
      expect(response.status).toBe(200)
      expect(executions).toBe(1)
      // The route shares this object with its execute closure, so a translated
      // payload is what the mutation actually runs against.
      for (const [field, value] of Object.entries(payload)) {
        expect(value, `${operation}.${field}`).toContain('destination')
      }
    }
  )

  it('sends a payload that mixes source-era and destination-era IDs to review', async () => {
    state.mappings = [
      { source_namespace: 'source-a', entity: 'profiles', source_id: 'source-user', destination_id: 'destination-user' },
      { source_namespace: 'source-a', entity: 'projects', source_id: 'source-project', destination_id: 'destination-project' },
    ]
    const payload = { projectId: 'source-project', activityTypeId: 'destination-activity' }
    let executions = 0
    const response = await withIdempotency(
      request('uncommitted-mixed'), 'destination-user', 'create_timesheet', payload,
      async () => { executions += 1; return Response.json({ ok: true }) }
    )
    expect(response.status).toBe(409)
    expect(executions).toBe(0)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('IDEMPOTENCY_NAMESPACE_AMBIGUOUS')
    expect(body.error.message).toContain('manual review')
  })

  it('sends an ID that exists on both sides of the mapping to review', async () => {
    state.mappings = [
      { source_namespace: 'source-a', entity: 'profiles', source_id: 'source-user', destination_id: 'destination-user' },
      { source_namespace: 'source-a', entity: 'timesheets', source_id: 'shared-id', destination_id: 'moved-elsewhere' },
      { source_namespace: 'source-a', entity: 'timesheets', source_id: 'another-source', destination_id: 'shared-id' },
    ]
    let executions = 0
    const response = await withIdempotency(
      request('uncommitted-collision'), 'destination-user', 'delete_timesheet', { id: 'shared-id' },
      async () => { executions += 1; return Response.json({ ok: true }) }
    )
    expect(response.status).toBe(409)
    expect(executions).toBe(0)
    expect((await response.json()).error.code).toBe('IDEMPOTENCY_NAMESPACE_AMBIGUOUS')
  })

  it('checks a remapped create_leave batch with the canonical effect fingerprint', async () => {
    state.effectFingerprint = 'a'.repeat(64)
    state.imported = [{
      source_namespace: 'source-a', source_actor_id: 'source-user', outcome: 'committed',
      response_status: 201, fingerprint_kind: 'effect-v1', fingerprint: state.effectFingerprint,
    }]
    state.mappings = [{
      source_namespace: 'source-a', entity: 'profiles', source_id: 'source-user', destination_id: 'destination-user',
    }]
    const response = await withIdempotency(
      request('portable-batch'), 'destination-user', 'create_leave',
      { rows: [{ userId: 'destination-user', leaveDate: '2026-09-20', reason: '' }] },
      async () => Response.json({ unexpected: true })
    )
    expect(response.status).toBe(201)
  })

  it('reverse-maps create_timesheet user and resource ids before checking an imported effect', async () => {
    state.effectFingerprint = 'b'.repeat(64)
    state.imported = [{
      source_namespace: 'source-a', source_actor_id: 'source-user', outcome: 'committed',
      response_status: 201, fingerprint_kind: 'effect-v1', fingerprint: state.effectFingerprint,
    }]
    state.mappings = [
      { source_namespace: 'source-a', entity: 'profiles', source_id: 'source-user', destination_id: 'destination-user' },
      { source_namespace: 'source-a', entity: 'projects', source_id: 'source-project', destination_id: 'destination-project' },
      { source_namespace: 'source-a', entity: 'activity_types', source_id: 'source-activity', destination_id: 'destination-activity' },
    ]

    const response = await withIdempotency(
      request('portable-create'), 'destination-user', 'create_timesheet',
      { userId: 'destination-user', projectId: 'destination-project', activityTypeId: 'destination-activity' },
      async () => Response.json({ unexpected: true })
    )

    expect(response.status).toBe(201)
    expect(state.effectPayload).toMatchObject({
      user_id: 'source-user',
      project_id: 'source-project',
      activity_type_id: 'source-activity',
    })
  })

  it('does not replay uncertain imported history', async () => {
    state.imported = [{
      source_namespace: 'source-a', source_actor_id: 'source-user', outcome: 'uncertain',
      response_status: 0, fingerprint_kind: 'request-json-v1', fingerprint: null,
    }]
    const response = await withIdempotency(
      request('portable-unknown'), 'destination-user', 'delete_timesheet', { id: 'source-row' },
      async () => Response.json({ unexpected: true })
    )
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('IDEMPOTENCY_COMMIT_UNKNOWN')
  })

  it('refuses a remapped actor\'s unresolvable key as manual review, never fresh work (C06A §2 rule 3)', async () => {
    state.mappings = [
      { source_namespace: 'source-a', entity: 'profiles', source_id: 'source-user', destination_id: 'destination-user' },
      { source_namespace: 'source-a', entity: 'projects', source_id: 'source-project', destination_id: 'destination-project' },
    ]
    // One id is a known destination record, the other is unknown to the
    // mapping in both directions: the payload cannot be proven post-cutover.
    const payload = { projectId: 'destination-project', activityTypeId: 'unknown-activity' }
    let executions = 0
    const response = await withIdempotency(
      request('unresolved-legacy'), 'destination-user', 'create_timesheet', payload,
      async () => { executions += 1; return Response.json({ ok: true }) }
    )
    expect(response.status).toBe(409)
    expect(executions).toBe(0)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('IDEMPOTENCY_REVIEW_REQUIRED')
    expect(body.error.message).toContain('manual review')
  })

  it('refuses a remapped actor\'s reference-free queued create for manual review', async () => {
    state.mappings = [
      { source_namespace: 'source-a', entity: 'profiles', source_id: 'source-user', destination_id: 'destination-user' },
    ]
    let executions = 0
    const response = await withIdempotency(
      request('unresolved-create'), 'destination-user', 'create_leave',
      { rows: [{ leaveDate: '2026-09-20', reason: 'no user reference' }] },
      async () => { executions += 1; return Response.json({ ok: true }) }
    )
    expect(response.status).toBe(409)
    expect(executions).toBe(0)
    expect((await response.json()).error.code).toBe('IDEMPOTENCY_REVIEW_REQUIRED')
  })

  it('executes a remapped actor\'s reference-free create only with a current server-issued key', async () => {
    state.mappings = [
      { source_namespace: 'source-a', entity: 'profiles', source_id: 'source-user', destination_id: 'destination-user' },
    ]
    state.freshKeyAdmitted = true
    let executions = 0
    const response = await withIdempotency(
      request('mf_server-issued'), 'destination-user', 'create_reminder',
      { message: 'new destination reminder' },
      async () => { executions += 1; return Response.json({ data: { success: true }, error: null }, { status: 201 }) },
      { successStatus: 201 }
    )
    expect(response.status).toBe(201)
    expect(executions).toBe(1)
  })

  it('replays a local committed create after ticket generation changes without executing again', async () => {
    state.mappings = [
      { source_namespace: 'source-a', entity: 'profiles', source_id: 'source-user', destination_id: 'destination-user' },
    ]
    const payload = { message: 'already created' }
    state.local = {
      payload_fingerprint: computePayloadFingerprint(payload), response_status: 201,
      response_payload: { data: { success: true }, error: null }, committed_unknown: false,
    }
    state.claimExisting = true
    // The ticket check would fail after a generation change. A durable local
    // success is replay evidence, not a request to admit a new effect.
    state.freshKeyAdmitted = false
    let executions = 0
    const response = await withIdempotency(
      request('mf_old-generation'), 'destination-user', 'create_reminder', payload,
      async () => { executions += 1; return Response.json({ unexpected: true }) },
      { successStatus: 201 }
    )
    expect(response.status).toBe(201)
    expect(executions).toBe(0)
    expect(await response.json()).toEqual({ data: { success: true }, error: null })
  })

  it('executes a remapped actor\'s payload whose ids are stable in the mapping', async () => {
    state.mappings = [
      { source_namespace: 'source-a', entity: 'profiles', source_id: 'source-user', destination_id: 'destination-user' },
      { source_namespace: 'source-a', entity: 'projects', source_id: 'stable-project', destination_id: 'stable-project' },
      { source_namespace: 'source-a', entity: 'activity_types', source_id: 'stable-activity', destination_id: 'stable-activity' },
    ]
    let executions = 0
    const response = await withIdempotency(
      request('stable-ids'), 'destination-user', 'create_timesheet',
      { projectId: 'stable-project', activityTypeId: 'stable-activity' },
      async () => { executions += 1; return Response.json({ ok: true }) }
    )
    expect(response.status).toBe(200)
    expect(executions).toBe(1)
  })

  it('keeps executing an unmapped actor\'s unknown key as fresh work', async () => {
    // The actor was never migrated: no portable context exists, so the
    // pre-migration behavior is unchanged.
    state.mappings = []
    let executions = 0
    const response = await withIdempotency(
      request('fresh-unmapped'), 'regular-user', 'delete_timesheet', { id: 'some-row' },
      async () => { executions += 1; return Response.json({ ok: true }) }
    )
    expect(response.status).toBe(200)
    expect(executions).toBe(1)
  })
})
