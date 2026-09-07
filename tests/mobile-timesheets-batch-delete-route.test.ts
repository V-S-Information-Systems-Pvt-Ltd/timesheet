import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireActor, mockBatchDelete, mockWithIdempotency } = vi.hoisted(() => ({
  mockRequireActor: vi.fn(),
  mockBatchDelete: vi.fn(),
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
  batchDeleteTimesheetsService: mockBatchDelete,
}))

vi.mock('@/lib/idempotency', () => ({
  withIdempotency: mockWithIdempotency,
}))

import { POST } from '@/app/api/v1/timesheets/batch-delete/route'

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
    requestId: 'req-batch-1',
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

describe('POST /api/v1/timesheets/batch-delete', () => {
  it('rejects invalid JSON request body with 400', async () => {
    const req = new Request('http://localhost/api/v1/timesheets/batch-delete', {
      method: 'POST',
      body: 'invalid-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects empty IDs array with 400', async () => {
    const req = new Request('http://localhost/api/v1/timesheets/batch-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects arrays exceeding 100 entries with 400', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`)
    const req = new Request('http://localhost/api/v1/timesheets/batch-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toContain('100')
  })

  it('executes batch delete and returns results with telemetry headers', async () => {
    mockBatchDelete.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          { id: 't1', success: true },
          { id: 't2', success: false, error: 'Timesheet entry not found.' },
        ],
        deletedCount: 1,
      },
    })

    const req = new Request('http://localhost/api/v1/timesheets/batch-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['t1', 't2'] }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('req-batch-1')
    expect(res.headers.get('x-response-time')).toMatch(/^\d+ms$/)

    const body = await res.json()
    expect(body.data.deletedCount).toBe(1)
    expect(body.data.results).toHaveLength(2)
    expect(mockBatchDelete).toHaveBeenCalledWith(actor, ['t1', 't2'])
  })

  it('wraps execution in withIdempotency and replays previous response without re-executing', async () => {
    mockBatchDelete.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [{ id: 't1', success: true }],
        deletedCount: 1,
      },
    })

    const req1 = new Request('http://localhost/api/v1/timesheets/batch-delete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'bdel-key-1',
      },
      body: JSON.stringify({ ids: ['t1'] }),
    })

    const res1 = await POST(req1)
    expect(res1.status).toBe(200)
    const body1 = await res1.json()
    expect(body1.data.deletedCount).toBe(1)
    expect(mockBatchDelete).toHaveBeenCalledTimes(1)
    expect(mockWithIdempotency).toHaveBeenCalledWith(
      expect.anything(),
      actor.id,
      'batch_delete_timesheets',
      { ids: ['t1'] },
      expect.any(Function)
    )

    // Replay with same key and payload
    const req2 = new Request('http://localhost/api/v1/timesheets/batch-delete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'bdel-key-1',
      },
      body: JSON.stringify({ ids: ['t1'] }),
    })

    const res2 = await POST(req2)
    expect(res2.status).toBe(200)
    const body2 = await res2.json()
    expect(body2.data.deletedCount).toBe(1)
    expect(mockBatchDelete).toHaveBeenCalledTimes(1)
  })

  it('rejects with 409 conflict when idempotency key is reused with different payload', async () => {
    mockBatchDelete.mockResolvedValueOnce({
      ok: true,
      data: {
        results: [{ id: 't1', success: true }],
        deletedCount: 1,
      },
    })

    const req1 = new Request('http://localhost/api/v1/timesheets/batch-delete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'bdel-conflict-key',
      },
      body: JSON.stringify({ ids: ['t1'] }),
    })
    const res1 = await POST(req1)
    expect(res1.status).toBe(200)

    const req2 = new Request('http://localhost/api/v1/timesheets/batch-delete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'bdel-conflict-key',
      },
      body: JSON.stringify({ ids: ['t2'] }),
    })
    const res2 = await POST(req2)
    expect(res2.status).toBe(409)
    const body2 = await res2.json()
    expect(body2.error.code).toBe('IDEMPOTENCY_CONFLICT')
  })
})
