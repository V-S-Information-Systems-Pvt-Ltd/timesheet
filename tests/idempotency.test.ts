import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  claimIdempotencyKey,
  commitIdempotencyKey,
  releaseIdempotencyKey,
  withIdempotency,
  computePayloadFingerprint,
  cleanupIdempotencyKeys,
} from '@/lib/idempotency'

const memoryStore = new Map<string, { payload_fingerprint: string; response_status: number; response_payload: unknown; created_at: Date; claimed_at: string; committed_unknown?: boolean }>()

vi.mock('@/lib/backend/config', () => ({
  IS_NATIVE: true,
  IS_SUPABASE: false,
}))

vi.mock('@/lib/db/pool', () => ({
  query: vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('with deleted as')) {
      const [cutoffIso] = params as [string]
      const cutoffDate = new Date(cutoffIso)
      let count = 0
      for (const [k, v] of Array.from(memoryStore.entries())) {
        if (v.created_at < cutoffDate) {
          memoryStore.delete(k)
          count++
        }
      }
      return [{ count: count.toString() }]
    }
    if (sql.includes('insert into public.idempotency_keys')) {
      const [key, actorId, operation, fingerprint] = params as [string, string, string, string]
      const composite = `${key}:${actorId}:${operation}`
      if (memoryStore.has(composite)) {
        return []
      }
      memoryStore.set(composite, {
        payload_fingerprint: fingerprint,
        response_status: 0,
        response_payload: {},
        created_at: new Date(),
        claimed_at: new Date().toISOString(),
        committed_unknown: false,
      })
      return [{ key }]
    }
    if (sql.includes('select payload_fingerprint')) {
      const [key, actorId, operation] = params as [string, string, string]
      const composite = `${key}:${actorId}:${operation}`
      const rec = memoryStore.get(composite)
      return rec ? [{ ...rec, committed_unknown: Boolean(rec.committed_unknown) }] : []
    }
    if (sql.includes('claimed_at = now()')) {
      // Stale-claim takeover: update ... set fingerprint, claimed_at where
      // status = 0 and committed_unknown = false and claimed_at < cutoff returning key
      const [fingerprint, key, actorId, operation, cutoffIso] = params as [string, string, string, string, string]
      const composite = `${key}:${actorId}:${operation}`
      const existing = memoryStore.get(composite)
      if (
        existing &&
        existing.response_status === 0 &&
        !existing.committed_unknown &&
        existing.payload_fingerprint === fingerprint &&
        existing.claimed_at < cutoffIso
      ) {
        existing.payload_fingerprint = fingerprint
        existing.claimed_at = new Date().toISOString()
        return [{ key }]
      }
      return []
    }
    if (sql.includes('set committed_unknown = true')) {
      const [key, actorId, operation] = params as [string, string, string]
      const composite = `${key}:${actorId}:${operation}`
      const existing = memoryStore.get(composite)
      if (existing) {
        existing.committed_unknown = true
      }
      return []
    }
    if (sql.includes('update public.idempotency_keys')) {
      const [status, payloadJson, key, actorId, operation] = params as [number, string, string, string, string]
      const composite = `${key}:${actorId}:${operation}`
      const existing = memoryStore.get(composite)
      if (existing) {
        existing.response_status = status
        existing.response_payload = JSON.parse(payloadJson)
      }
      return []
    }
    if (sql.includes('delete from public.idempotency_keys')) {
      const [key, actorId, operation] = params as [string, string, string]
      const composite = `${key}:${actorId}:${operation}`
      const existing = memoryStore.get(composite)
      if (existing && existing.response_status === 0 && !existing.committed_unknown) {
        memoryStore.delete(composite)
      }
      return []
    }
    return []
  }),
  transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
}))

describe('lib/idempotency', () => {
  beforeEach(() => {
    memoryStore.clear()
    vi.clearAllMocks()
  })

  it('claims a new key and allows committing the result', async () => {
    const fp = computePayloadFingerprint({ a: 1 })
    const claim = await claimIdempotencyKey('k-1', 'act-1', 'create_timesheet', fp)
    expect(claim.state).toBe('claimed')

    await commitIdempotencyKey('k-1', 'act-1', 'create_timesheet', 201, { id: 'ts-1' })

    const replay = await claimIdempotencyKey('k-1', 'act-1', 'create_timesheet', fp)
    expect(replay.state).toBe('replay')
    if (replay.state === 'replay') {
      expect(replay.record.status).toBe(201)
      expect(replay.record.payload).toEqual({ id: 'ts-1' })
    }
  })

  it('detects conflict when key is reused with different payload', async () => {
    const fp1 = computePayloadFingerprint({ a: 1 })
    const fp2 = computePayloadFingerprint({ a: 2 })

    await claimIdempotencyKey('k-2', 'act-1', 'create_timesheet', fp1)
    await commitIdempotencyKey('k-2', 'act-1', 'create_timesheet', 201, { ok: true })

    const claim2 = await claimIdempotencyKey('k-2', 'act-1', 'create_timesheet', fp2)
    expect(claim2.state).toBe('conflict')
  })

  it('reports in-flight (not conflict) when another request holds a fresh claim', async () => {
    const fp = computePayloadFingerprint({ a: 1 })
    const claim1 = await claimIdempotencyKey('k-3', 'act-1', 'create_timesheet', fp)
    expect(claim1.state).toBe('claimed')

    // Second claim before commit with the same payload is transient in-flight,
    // while a different payload is a permanent conflict.
    const claim2 = await claimIdempotencyKey('k-3', 'act-1', 'create_timesheet', fp)
    expect(claim2.state).toBe('in_flight')
    const claim3 = await claimIdempotencyKey('k-3', 'act-1', 'create_timesheet', computePayloadFingerprint({ a: 2 }))
    expect(claim3.state).toBe('conflict')
  })

  it('reclaims a stale in-flight claim instead of poisoning the key', async () => {
    const fp = computePayloadFingerprint({ a: 1 })
    await claimIdempotencyKey('k-stale', 'act-1', 'create_timesheet', fp)
    // Simulate a crash between a committed mutation and the ledger commit.
    const rec = memoryStore.get('k-stale:act-1:create_timesheet')
    expect(rec?.response_status).toBe(0)
    rec!.claimed_at = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const retry = await claimIdempotencyKey('k-stale', 'act-1', 'create_timesheet', fp)
    expect(retry.state).toBe('claimed')
  })

  it('withIdempotency returns retryable 409 IN_FLIGHT for a live claim without executing', async () => {
    const fp = computePayloadFingerprint({ data: 'held' })
    await claimIdempotencyKey('idem-held', 'act-1', 'op-1', fp)

    let runs = 0
    const req = new Request('http://localhost/api/v1/timesheets', {
      headers: { 'idempotency-key': 'idem-held' },
    })
    const res = await withIdempotency(req, 'act-1', 'op-1', { data: 'held' }, async () => {
      runs++
      return Response.json({ ok: true }, { status: 200 })
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_IN_FLIGHT')
    expect(runs).toBe(0)
  })

  it('releases key on error allowing retry', async () => {
    const fp = computePayloadFingerprint({ a: 1 })
    await claimIdempotencyKey('k-4', 'act-1', 'create_timesheet', fp)
    await releaseIdempotencyKey('k-4', 'act-1', 'create_timesheet')

    const retry = await claimIdempotencyKey('k-4', 'act-1', 'create_timesheet', fp)
    expect(retry.state).toBe('claimed')
  })

  it('withIdempotency passes through when header is absent', async () => {
    const req = new Request('http://localhost/api/v1/timesheets', { method: 'POST' })
    let executed = false
    const res = await withIdempotency(req, 'act-1', 'create_timesheet', { a: 1 }, async () => {
      executed = true
      return Response.json({ success: true }, { status: 201 })
    })

    expect(executed).toBe(true)
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data).toEqual({ success: true })
  })

  it('withIdempotency claims, commits, and replays on second call', async () => {
    let runs = 0
    const execute = async () => {
      runs++
      return Response.json({ count: runs }, { status: 200 })
    }

    const req1 = new Request('http://localhost/api/v1/timesheets', {
      method: 'POST',
      headers: { 'idempotency-key': 'idem-run-1' },
    })
    const res1 = await withIdempotency(req1, 'act-1', 'op-1', { data: 'test' }, execute)
    expect(res1.status).toBe(200)
    expect(await res1.json()).toEqual({ count: 1 })
    expect(runs).toBe(1)

    // Second call with same key and payload
    const req2 = new Request('http://localhost/api/v1/timesheets', {
      method: 'POST',
      headers: { 'idempotency-key': 'idem-run-1' },
    })
    const res2 = await withIdempotency(req2, 'act-1', 'op-1', { data: 'test' }, execute)
    expect(res2.status).toBe(200)
    expect(await res2.json()).toEqual({ count: 1 })
    expect(runs).toBe(1) // execute NOT called again
  })

  it('withIdempotency returns 409 when key reused with different payload', async () => {
    const execute = async () => Response.json({ ok: true }, { status: 200 })

    const req1 = new Request('http://localhost/api/v1/timesheets', {
      headers: { 'idempotency-key': 'idem-diff-1' },
    })
    await withIdempotency(req1, 'act-1', 'op-1', { payload: 'original' }, execute)

    const req2 = new Request('http://localhost/api/v1/timesheets', {
      headers: { 'idempotency-key': 'idem-diff-1' },
    })
    const res2 = await withIdempotency(req2, 'act-1', 'op-1', { payload: 'tampered' }, execute)
    expect(res2.status).toBe(409)
    const err = await res2.json()
    expect(err.error.code).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('fails closed when database query throws on claim', async () => {
    const pool = await import('@/lib/db/pool')
    vi.mocked(pool.query).mockRejectedValueOnce(new Error('DB connection failed'))

    const fp = computePayloadFingerprint({ a: 1 })
    await expect(claimIdempotencyKey('fail-key', 'act-1', 'op-1', fp)).rejects.toThrow('DB connection failed')
  })

  it('fails closed when database update throws on commit', async () => {
    const pool = await import('@/lib/db/pool')
    vi.mocked(pool.query).mockRejectedValueOnce(new Error('DB commit failed'))

    await expect(commitIdempotencyKey('fail-key', 'act-1', 'op-1', 200, {})).rejects.toThrow('DB commit failed')
  })

  it('prunes records older than 97 days but preserves 96-day-old records', async () => {
    const now = Date.now()
    const ninetySixDaysAgo = new Date(now - 96 * 24 * 60 * 60 * 1000)
    const ninetyEightDaysAgo = new Date(now - 98 * 24 * 60 * 60 * 1000)

    memoryStore.set('k-recent:act-1:op-1', {
      payload_fingerprint: 'fp-recent',
      response_status: 200,
      response_payload: { ok: true },
      created_at: ninetySixDaysAgo,
      claimed_at: ninetySixDaysAgo.toISOString(),
    })

    memoryStore.set('k-old:act-1:op-1', {
      payload_fingerprint: 'fp-old',
      response_status: 200,
      response_payload: { ok: true },
      created_at: ninetyEightDaysAgo,
      claimed_at: ninetyEightDaysAgo.toISOString(),
    })

    const deletedCount = await cleanupIdempotencyKeys(97)
    expect(deletedCount).toBe(1)
    expect(memoryStore.has('k-recent:act-1:op-1')).toBe(true)
    expect(memoryStore.has('k-old:act-1:op-1')).toBe(false)
  })

  it('never releases idempotency key if mutation committed even if commit throws (unit-level; real rollback in idempotency.int.test.ts)', async () => {
    const req = new Request('http://localhost/api/v1/timesheets', {
      headers: { 'idempotency-key': 'idem-safe-1' },
    })

    const pool = await import('@/lib/db/pool')
    const origQuery = vi.mocked(pool.query).getMockImplementation()!
    vi.mocked(pool.query).mockImplementation(async (sql, params) => {
      if (sql.includes('update public.idempotency_keys')) {
        throw new Error('Commit failed')
      }
      return origQuery(sql, params)
    })

    const execute = async () => {
      return Response.json({ success: true }, { status: 200 })
    }

    await expect(withIdempotency(req, 'act-1', 'op-1', { data: 'test' }, execute)).rejects.toThrow('Commit failed')

    // The key should NOT be deleted from memoryStore
    expect(memoryStore.has('idem-safe-1:act-1:op-1')).toBe(true)
  })

  it('committed_unknown row blocks takeover even when stale (native)', async () => {
    const fp = computePayloadFingerprint({ data: 'stale-native' })
    await claimIdempotencyKey('k-blocked-native', 'act-1', 'op-1', fp)
    const rec = memoryStore.get('k-blocked-native:act-1:op-1')
    expect(rec).toBeDefined()
    rec!.committed_unknown = true
    rec!.claimed_at = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const claim = await claimIdempotencyKey('k-blocked-native', 'act-1', 'op-1', fp)
    expect(claim.state).toBe('committed_unknown')
  })

  it('withIdempotency returns 409 IDEMPOTENCY_COMMIT_UNKNOWN for a committed_unknown claim (native)', async () => {
    const fp = computePayloadFingerprint({ data: 'stale-native' })
    await claimIdempotencyKey('k-comm-unk', 'act-1', 'op-1', fp)
    const rec = memoryStore.get('k-comm-unk:act-1:op-1')
    expect(rec).toBeDefined()
    rec!.committed_unknown = true

    let runs = 0
    const req = new Request('http://localhost/api/v1/timesheets', {
      headers: { 'idempotency-key': 'k-comm-unk' },
    })
    const res = await withIdempotency(req, 'act-1', 'op-1', { data: 'stale-native' }, async () => {
      runs++
      return Response.json({ success: true })
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('IDEMPOTENCY_COMMIT_UNKNOWN')
    expect(runs).toBe(0)
  })
})

