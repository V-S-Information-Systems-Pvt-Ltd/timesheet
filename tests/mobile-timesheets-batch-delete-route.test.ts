import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireActor, mockBatchDelete } = vi.hoisted(() => ({
  mockRequireActor: vi.fn(),
  mockBatchDelete: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', async () => {
  const actual = await vi.importActual<typeof import('@/app/api/v1/_http')>('@/app/api/v1/_http')
  return {
    ...actual,
    requireMobileActor: mockRequireActor,
  }
})

vi.mock('@/lib/api/v1/services/timesheets', () => ({
  batchDeleteTimesheetsService: mockBatchDelete,
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
})
