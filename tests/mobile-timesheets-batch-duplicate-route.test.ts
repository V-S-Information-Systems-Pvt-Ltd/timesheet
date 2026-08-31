import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireActor, mockBatchDuplicate } = vi.hoisted(() => ({
  mockRequireActor: vi.fn(),
  mockBatchDuplicate: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', async () => {
  const actual = await vi.importActual<typeof import('@/app/api/v1/_http')>('@/app/api/v1/_http')
  return {
    ...actual,
    requireMobileActor: mockRequireActor,
  }
})

vi.mock('@/lib/api/v1/services/timesheets', () => ({
  batchDuplicateTimesheetsService: mockBatchDuplicate,
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
})
