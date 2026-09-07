import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  claimIdempotencyKey,
  commitIdempotencyKey,
  releaseIdempotencyKey,
  withIdempotency,
  computePayloadFingerprint,
} from '@/lib/idempotency'

// Supabase branch (IS_NATIVE=false) — the deviated claim->execute->commit path.
// Uses an in-memory ledger backed by the mocked getAdminClient so the same
// exactly-once semantics exercised by the native tests are proven here too.

interface LedgerRecord {
  fp: string
  status: number
  payload: unknown
  claimedAt: string
  committedUnknown?: boolean
}

const ledger = new Map<string, LedgerRecord>()

const { mockGetAdminClient } = vi.hoisted(() => ({
  mockGetAdminClient: vi.fn(),
}))

vi.mock('@/lib/backend/config', () => ({
  IS_NATIVE: false,
  IS_SUPABASE: true,
}))

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: mockGetAdminClient,
}))

function buildAdminClient() {
  return {
    from: (_table: string) => {
      const insert = async (row: Record<string, unknown>) => {
        const c = `${row.key}:${row.actor_id}:${row.operation}`
        if (ledger.has(c)) return { error: { code: '23505', message: 'duplicate' } }
        ledger.set(c, {
          fp: row.payload_fingerprint as string,
          status: 0,
          payload: {},
          claimedAt: (row.claimed_at as string) ?? new Date().toISOString(),
          committedUnknown: Boolean(row.committed_unknown),
        })
        return { error: null }
      }
      const select = (_columns: string) => ({
        eq: (col1: string, v1: string) => ({
          eq: (col2: string, v2: string) => ({
            eq: (col3: string, v3: string) => ({
              maybeSingle: async () => {
                const c = `${v1}:${v2}:${v3}`
                const rec = ledger.get(c)
                return {
                  data: rec
                    ? {
                        payload_fingerprint: rec.fp,
                        response_status: rec.status,
                        response_payload: rec.payload,
                        claimed_at: rec.claimedAt,
                        committed_unknown: Boolean(rec.committedUnknown),
                      }
                    : null,
                  error: null,
                }
              },
            }),
          }),
        }),
      })
      const update = (vals: Record<string, unknown>) => ({
        eq: (col1: string, v1: string) => ({
          eq: (col2: string, v2: string) => ({
            eq: (col3: string, v3: string) => {
              if ('response_status' in vals) {
                const c = `${v1}:${v2}:${v3}`
                const rec = ledger.get(c)
                if (rec) {
                  rec.status = vals.response_status as number
                  rec.payload = vals.response_payload as unknown
                }
              }
              if ('committed_unknown' in vals) {
                const c = `${v1}:${v2}:${v3}`
                const rec = ledger.get(c)
                if (rec) {
                  rec.committedUnknown = Boolean(vals.committed_unknown)
                }
              }
              return {
                error: null,
                // Stale-claim takeover continuation:
                // .eq('response_status', 0).eq('committed_unknown', false).eq('payload_fingerprint', fp).lt('claimed_at', cutoff).select('key')
                eq: (_c4: string, statusVal: number) => ({
                  eq: (_c5: string, committedUnknownVal: boolean) => ({
                    eq: (_c6: string, fpVal: string) => ({
                      lt: (_c7: string, cutoffIso: string) => ({
                        select: async (_cols: string) => {
                          const c = `${v1}:${v2}:${v3}`
                          const rec = ledger.get(c)
                          if (
                            rec &&
                            rec.status === statusVal &&
                            Boolean(rec.committedUnknown) === committedUnknownVal &&
                            rec.fp === fpVal &&
                            rec.claimedAt < cutoffIso
                          ) {
                            rec.fp = vals.payload_fingerprint as string
                            rec.claimedAt = (vals.claimed_at as string) ?? new Date().toISOString()
                            return { data: [{ key: v1 }], error: null }
                          }
                          return { data: [], error: null }
                        },
                      }),
                    }),
                  }),
                }),
              }
            },
          }),
        }),
      })
      const del = () => ({
        eq: (col1: string, v1: string) => ({
          eq: (col2: string, v2: string) => ({
            eq: (col3: string, v3: string) => ({
              eq: (_col4: string, statusVal: number) => ({
                eq: (_col5: string, committedUnknownVal: boolean) => {
                  const c = `${v1}:${v2}:${v3}`
                  const rec = ledger.get(c)
                  if (rec && rec.status === statusVal && Boolean(rec.committedUnknown) === committedUnknownVal) {
                    ledger.delete(c)
                  }
                  return Promise.resolve({ error: null })
                },
              }),
            }),
          }),
        }),
      })
      return { insert, select, update, delete: del }
    },
  }
}

describe('lib/idempotency (Supabase branch)', () => {
  beforeEach(() => {
    ledger.clear()
    vi.clearAllMocks()
    mockGetAdminClient.mockImplementation(() => buildAdminClient())
  })

  it('claims, commits, and replays on second call', async () => {
    const fp = computePayloadFingerprint({ a: 1 })
    const c1 = await claimIdempotencyKey('k1', 'act-1', 'create_timesheet', fp)
    expect(c1.state).toBe('claimed')

    await commitIdempotencyKey('k1', 'act-1', 'create_timesheet', 201, { id: 'ts-1' })

    const replay = await claimIdempotencyKey('k1', 'act-1', 'create_timesheet', fp)
    expect(replay.state).toBe('replay')
    if (replay.state === 'replay') {
      expect(replay.record.status).toBe(201)
      expect(replay.record.payload).toEqual({ id: 'ts-1' })
    }
  })

  it('detects conflict on different payload', async () => {
    const fp1 = computePayloadFingerprint({ a: 1 })
    await claimIdempotencyKey('k2', 'act-1', 'create_timesheet', fp1)
    await commitIdempotencyKey('k2', 'act-1', 'create_timesheet', 201, {})
    const c2 = await claimIdempotencyKey('k2', 'act-1', 'create_timesheet', computePayloadFingerprint({ a: 2 }))
    expect(c2.state).toBe('conflict')
  })

  it('reports in-flight (not conflict) for a live claim held by a concurrent request', async () => {
    const fp = computePayloadFingerprint({ a: 1 })
    await claimIdempotencyKey('k3', 'act-1', 'create_timesheet', fp)
    const c2 = await claimIdempotencyKey('k3', 'act-1', 'create_timesheet', fp)
    expect(c2.state).toBe('in_flight')
  })

  it('transitions a stale in-flight claim to committed_unknown instead of re-executing (prevent duplicate writes)', async () => {
    const fp = computePayloadFingerprint({ a: 1 })
    await claimIdempotencyKey('k-stale', 'act-1', 'create_timesheet', fp)
    const rec = ledger.get('k-stale:act-1:create_timesheet')
    expect(rec?.status).toBe(0)
    // Simulate a crash after mutation but before ledger commit: status is 0 and claimed_at is stale
    rec!.claimedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const retry = await claimIdempotencyKey('k-stale', 'act-1', 'create_timesheet', fp)
    expect(retry.state).toBe('committed_unknown')
    expect(rec?.committedUnknown).toBe(true)
  })

  it('withIdempotency returns retryable 409 IN_FLIGHT for a live claim without executing', async () => {
    const fp = computePayloadFingerprint({ data: 'held' })
    await claimIdempotencyKey('idem-held', 'act-1', 'op-1', fp)

    let runs = 0
    const req = new Request('http://localhost/x', { headers: { 'idempotency-key': 'idem-held' } })
    const res = await withIdempotency(req, 'act-1', 'op-1', { data: 'held' }, async () => {
      runs++
      return Response.json({ ok: true }, { status: 200 })
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_IN_FLIGHT')
    expect(runs).toBe(0)
  })

  it('releases an uncommitted claim allowing retry', async () => {
    const fp = computePayloadFingerprint({ a: 1 })
    await claimIdempotencyKey('k4', 'act-1', 'create_timesheet', fp)
    await releaseIdempotencyKey('k4', 'act-1', 'create_timesheet')
    const retry = await claimIdempotencyKey('k4', 'act-1', 'create_timesheet', fp)
    expect(retry.state).toBe('claimed')
  })

  it('withIdempotency runs the mutation through execute() and replays on retry', async () => {
    let runs = 0
    const execute = async () => {
      runs++
      return Response.json({ count: runs }, { status: 200 })
    }
    const req1 = new Request('http://localhost/x', { headers: { 'idempotency-key': 'idem-sb-1' } })
    const res1 = await withIdempotency(req1, 'act-1', 'op-1', { data: 'x' }, execute)
    expect(res1.status).toBe(200)
    expect(runs).toBe(1)

    const req2 = new Request('http://localhost/x', { headers: { 'idempotency-key': 'idem-sb-1' } })
    const res2 = await withIdempotency(req2, 'act-1', 'op-1', { data: 'x' }, execute)
    expect(res2.status).toBe(200)
    expect(runs).toBe(1)
  })

  it('does NOT report success when the ledger commit fails after a successful mutation (no silent duplicate)', async () => {
    mockGetAdminClient.mockImplementation(() => {
      const base = buildAdminClient()
      const client = base as unknown as { from: (t: string) => { update: (v: Record<string, unknown>) => unknown; insert: (r: Record<string, unknown>) => Promise<{ error: unknown }>; select: (c: string) => unknown; delete: () => unknown } }
      return {
        ...client,
        from: (t: string) => {
          const table = client.from(t) as {
            insert: (r: Record<string, unknown>) => Promise<{ error: unknown }>
            update: (v: Record<string, unknown>) => unknown
            select: (c: string) => unknown
            delete: () => unknown
          }
          if (t === 'idempotency_keys') {
            return {
              ...table,
              update: (v: Record<string, unknown>) => {
                if ('committed_unknown' in v) {
                  return {
                    eq: (col1: string, v1: string) => ({
                      eq: (col2: string, v2: string) => ({
                        eq: (col3: string, v3: string) => {
                          const c = `${v1}:${v2}:${v3}`
                          const rec = ledger.get(c)
                          if (rec) rec.committedUnknown = true
                          return Promise.resolve({ error: null })
                        },
                      }),
                    }),
                  }
                }
                return {
                  eq: () => ({
                    eq: () => ({
                      eq: () => Promise.resolve({ error: { message: 'commit failed' } }),
                    }),
                  }),
                }
              },
            }
          }
          return table
        },
      }
    })

    const execute = async () => Response.json({ success: true }, { status: 200 })
    const req = new Request('http://localhost/x', { headers: { 'idempotency-key': 'idem-sb-commit-fail' } })
    const res = await withIdempotency(req, 'act-1', 'op-1', { data: 'y' }, execute)
    // Must NOT be 200-success: returning success after a failed ledger write
    // would let the client dequeue and a later retry re-execute (duplicate).
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('IDEMPOTENCY_COMMIT_UNKNOWN')
    // Key is marked committed_unknown in ledger
    const rec = ledger.get('idem-sb-commit-fail:act-1:op-1')
    expect(rec?.committedUnknown).toBe(true)
  })

  it('commit-failure retry past 5 min does NOT re-execute → 409 COMMIT_UNKNOWN', async () => {
    const fp = computePayloadFingerprint({ data: 'past-5-min' })
    await claimIdempotencyKey('k-unknown', 'act-1', 'op-1', fp)
    const rec = ledger.get('k-unknown:act-1:op-1')
    expect(rec).toBeDefined()
    rec!.committedUnknown = true
    // Stale: older than 5 minutes
    rec!.claimedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    let executed = 0
    const req = new Request('http://localhost/x', { headers: { 'idempotency-key': 'k-unknown' } })
    const res = await withIdempotency(req, 'act-1', 'op-1', { data: 'past-5-min' }, async () => {
      executed++
      return Response.json({ success: true })
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('IDEMPOTENCY_COMMIT_UNKNOWN')
    expect(executed).toBe(0)
  })

  it('committed_unknown row blocks takeover even when stale', async () => {
    const fp = computePayloadFingerprint({ data: 'stale-blocked' })
    await claimIdempotencyKey('k-blocked', 'act-1', 'op-1', fp)
    const rec = ledger.get('k-blocked:act-1:op-1')
    rec!.committedUnknown = true
    rec!.claimedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const claim = await claimIdempotencyKey('k-blocked', 'act-1', 'op-1', fp)
    expect(claim.state).toBe('committed_unknown')
  })

  it('commit retry succeeds on second attempt without marking committed_unknown', async () => {
    let commitAttempts = 0
    mockGetAdminClient.mockImplementation(() => {
      const base = buildAdminClient()
      const client = base as unknown as { from: (t: string) => { update: (v: Record<string, unknown>) => unknown; insert: (r: Record<string, unknown>) => Promise<{ error: unknown }>; select: (c: string) => unknown; delete: () => unknown } }
      return {
        ...client,
        from: (t: string) => {
          const table = client.from(t) as {
            insert: (r: Record<string, unknown>) => Promise<{ error: unknown }>
            update: (v: Record<string, unknown>) => unknown
            select: (c: string) => unknown
            delete: () => unknown
          }
          if (t === 'idempotency_keys') {
            return {
              ...table,
              update: (v: Record<string, unknown>) => {
                if ('response_status' in v) {
                  commitAttempts++
                  if (commitAttempts === 1) {
                    return {
                      eq: () => ({
                        eq: () => ({
                          eq: () => Promise.resolve({ error: { message: 'transient db glitch' } }),
                        }),
                      }),
                    }
                  }
                  return {
                    eq: (col1: string, v1: string) => ({
                      eq: (col2: string, v2: string) => ({
                        eq: (col3: string, v3: string) => {
                          const c = `${v1}:${v2}:${v3}`
                          const rec = ledger.get(c)
                          if (rec) {
                            rec.status = v.response_status as number
                            rec.payload = v.response_payload as unknown
                          }
                          return Promise.resolve({ error: null })
                        },
                      }),
                    }),
                  }
                }
                return table.update(v)
              },
            }
          }
          return table
        },
      }
    })

    const req = new Request('http://localhost/x', { headers: { 'idempotency-key': 'idem-retry-ok' } })
    const res = await withIdempotency(req, 'act-1', 'op-1', { data: 'retry-test' }, async () => {
      return Response.json({ result: 'done' }, { status: 200 })
    })

    expect(res.status).toBe(200)
    expect(commitAttempts).toBe(2)
    const rec = ledger.get('idem-retry-ok:act-1:op-1')
    expect(rec?.status).toBe(200)
    expect(rec?.committedUnknown).toBe(false)
  })

  it('fingerprint is independent of JSON key order', () => {
    const a = computePayloadFingerprint({ b: 1, a: { x: 2 } })
    const b = computePayloadFingerprint({ a: { x: 2 }, b: 1 })
    expect(a).toBe(b)
  })
})
