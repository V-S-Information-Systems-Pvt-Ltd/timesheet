import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireActor, mockBatchDuplicate, mockWithIdempotency } = vi.hoisted(() => ({
  mockRequireActor: vi.fn(),
  mockBatchDuplicate: vi.fn(),
  mockWithIdempotency: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', async () => {
  const actual = await vi.importActual<typeof import('@/app/api/v1/_http')>('@/app/api/v1/_http')
  return {
    ...actual,
    requireMobileActor: mockRequireActor,
    withMobileActor: vi.fn(async (req: Request, fn: (auth: unknown) => Promise<unknown>) => {
      const auth = (await mockRequireActor(req)) as { ok: boolean; response?: unknown }
      if (!auth.ok) return auth.response
      return fn(auth)
    }),
  }
})

vi.mock('@/lib/api/v1/services/timesheets', () => ({
  batchDuplicateTimesheetsService: mockBatchDuplicate,
}))

vi.mock('@/lib/idempotency', () => ({
  withIdempotency: mockWithIdempotency,
}))

import { POST } from '@/app/api/v1/timesheets/batch-duplicate/route'

const actor = {
  id: 'user-1',
  email: 'u@example.com',
  role: 'user' as const,
  permission_role: 'user' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireActor.mockResolvedValue({
    ok: true,
    actor,
    sessionId: 'session-1',
    requestId: 'req-batch-dup-1',
    startTime: performance.now(),
  })

  const idempotencyStore = new Map<string, { fingerprint: string; response: Response }>()
  mockWithIdempotency.mockImplementation(
    async (
      request: Request,
      actorId: string,
      operation: string,
      payload: unknown,
      execute: () => Promise<Response>
    ) => {
      const key = request.headers.get('idempotency-key') || request.headers.get('x-idempotency-key')
      if (!key) return execute()
      const fp = JSON.stringify(payload)
      const composite = `${key}:${actorId}:${operation}`
      const existing = idempotencyStore.get(composite)
      if (existing) {
        if (existing.fingerprint !== fp) {
          return Response.json(
            {
              data: null,
              error: {
                code: 'IDEMPOTENCY_CONFLICT',
                message: 'Idempotency key reused with different payload.',
              },
            },
            { status: 409 }
          )
        }
        return existing.response.clone()
      }
      const res = await execute()
      idempotencyStore.set(composite, { fingerprint: fp, response: res.clone() })
      return res
    }
  )
})

describe('POST /api/v1/timesheets/batch-duplicate', () => {
  it('rejects invalid JSON request body with 400', async () => {
    const req = new Request('http://localhost/api/v1/timesheets/batch-duplicate', {
      method: 'POST',
      body: 'invalid-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects empty items array with 400', async () => {
    const req = new Request('http://localhost/api/v1/timesheets/batch-duplicate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects items exceeding 100 entries with 400', async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ id: `id-${i}` }))
    const req = new Request('http://localhost/api/v1/timesheets/batch-duplicate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toContain('100')
  })

  it('executes batch duplicate and returns results with telemetry headers', async () => {
    mockBatchDuplicate.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          { id: 't1', success: true, entry: { id: 'dup-1', userId: 'user-1', logDate: '2026-08-30' } },
          { id: 't2', success: false, error: 'Timesheet entry not found.' },
        ],
        duplicatedCount: 1,
      },
    })

    const req = new Request('http://localhost/api/v1/timesheets/batch-duplicate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ id: 't1' }, { id: 't2' }] }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('req-batch-dup-1')
    expect(res.headers.get('x-response-time')).toMatch(/^\d+ms$/)

    const body = await res.json()
    expect(body.data.duplicatedCount).toBe(1)
    expect(body.data.results).toHaveLength(2)
    expect(mockBatchDuplicate).toHaveBeenCalledWith(actor, [{ id: 't1' }, { id: 't2' }])
  })

  it('passes targetDate per item through schema validation to service', async () => {
    mockBatchDuplicate.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          { id: 't1', success: true, entry: { id: 'dup-1', userId: 'user-1', logDate: '2026-08-31' } },
        ],
        duplicatedCount: 1,
      },
    })

    const req = new Request('http://localhost/api/v1/timesheets/batch-duplicate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ id: 't1', targetDate: '2026-08-31' }] }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockBatchDuplicate).toHaveBeenCalledWith(actor, [{ id: 't1', targetDate: '2026-08-31' }])
  })

  it('wraps execution in withIdempotency and replays previous response without re-executing', async () => {
    mockBatchDuplicate.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [{ id: 't1', success: true, entry: { id: 'dup-1', userId: 'user-1', logDate: '2026-08-31' } }],
        duplicatedCount: 1,
      },
    })

    const req1 = new Request('http://localhost/api/v1/timesheets/batch-duplicate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'bdup-key-1',
      },
      body: JSON.stringify({ items: [{ id: 't1', targetDate: '2026-08-31' }] }),
    })

    const res1 = await POST(req1)
    expect(res1.status).toBe(200)
    const body1 = await res1.json()
    expect(body1.data.duplicatedCount).toBe(1)
    expect(mockBatchDuplicate).toHaveBeenCalledTimes(1)
    expect(mockWithIdempotency).toHaveBeenCalledWith(
      expect.anything(),
      actor.id,
      'batch_duplicate_timesheets',
      { items: [{ id: 't1', targetDate: '2026-08-31' }] },
      expect.any(Function),
      // T19.2: replay reauthorization must recheck every source entry.
      expect.objectContaining({ reauthorize: expect.any(Function) })
    )

    // Replay with same key and payload
    const req2 = new Request('http://localhost/api/v1/timesheets/batch-duplicate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'bdup-key-1',
      },
      body: JSON.stringify({ items: [{ id: 't1', targetDate: '2026-08-31' }] }),
    })

    const res2 = await POST(req2)
    expect(res2.status).toBe(200)
    const body2 = await res2.json()
    expect(body2.data.duplicatedCount).toBe(1)
    expect(mockBatchDuplicate).toHaveBeenCalledTimes(1)
  })

  it('rejects with 409 conflict when idempotency key is reused with different payload', async () => {
    mockBatchDuplicate.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [{ id: 't1', success: true }],
        duplicatedCount: 1,
      },
    })

    const req1 = new Request('http://localhost/api/v1/timesheets/batch-duplicate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'bdup-conflict-key',
      },
      body: JSON.stringify({ items: [{ id: 't1' }] }),
    })
    const res1 = await POST(req1)
    expect(res1.status).toBe(200)

    const req2 = new Request('http://localhost/api/v1/timesheets/batch-duplicate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'bdup-conflict-key',
      },
      body: JSON.stringify({ items: [{ id: 't2' }] }),
    })
    const res2 = await POST(req2)
    expect(res2.status).toBe(409)
    const body2 = await res2.json()
    expect(body2.error.code).toBe('IDEMPOTENCY_CONFLICT')
  })
})
