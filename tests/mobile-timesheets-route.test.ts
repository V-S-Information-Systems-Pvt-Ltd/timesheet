import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockList } = vi.hoisted(() => ({ mockRequire: vi.fn(), mockList: vi.fn() }))
vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  apiError: vi.fn((code: string, message: string, status: number) => ({ body: { error: { code, message } }, status })),
  serverError: vi.fn(() => ({ status: 500 })),
}))
vi.mock('@/lib/db/mobile-timesheets', () => ({ listMobileActorTimesheets: mockList }))

import { GET } from '@/app/api/v1/timesheets/route'

const actor = { id: 'user-1', email: 'u@example.com', isActive: true }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
  mockList.mockResolvedValue({ rows: [], count: 0 })
})

describe('GET /api/v1/timesheets', () => {
  it('passes validated filters to the authenticated mobile actor query', async () => {
    const response = (await GET(new Request('http://localhost/api/v1/timesheets?dateFrom=2026-08-01&limit=10'))) as unknown as { status: number; body: { data: unknown } }
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ rows: [], count: 0 })
    expect(mockList).toHaveBeenCalledWith(actor, { dateFrom: '2026-08-01', limit: 10 })
  })

  it('rejects invalid filters before querying', async () => {
    const response = (await GET(new Request('http://localhost/api/v1/timesheets?limit=-1'))) as unknown as { status: number }
    expect(response.status).toBe(400)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('does not accept a userId filter from the mobile request', async () => {
    await GET(new Request('http://localhost/api/v1/timesheets?userId=another-user'))
    expect(mockList).toHaveBeenCalledWith(actor, {})
  })
})
