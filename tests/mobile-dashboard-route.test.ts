import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockList } = vi.hoisted(() => ({ mockRequire: vi.fn(), mockList: vi.fn() }))
vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  serverError: vi.fn(() => ({ status: 500 })),
}))
vi.mock('@/lib/db/mobile-timesheets', () => ({ listMobileActorTimesheets: mockList }))

import { GET } from '@/app/api/v1/dashboard/route'

const actor = {
  id: 'user-1', email: 'u@example.com', role: 'user', permission_role: 'user',
  hierarchy_role: 'user', isActive: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
  mockList.mockResolvedValue({
    rows: [
      { id: 't1', log_date: new Date().toISOString().slice(0, 10), hours_worked: 4 },
      { id: 't2', log_date: '2000-01-01', hours_worked: 3 },
    ],
    count: 2,
  })
})

describe('GET /api/v1/dashboard', () => {
  it('returns current totals and recent entries for the authenticated mobile actor', async () => {
    const response = (await GET(new Request('http://localhost/api/v1/dashboard'))) as unknown as {
      status: number
      body: { data: { today: { hours: number }; week: { hours: number }; recentEntries: unknown[] } }
    }
    expect(response.status).toBe(200)
    expect(response.body.data.today.hours).toBe(4)
    expect(response.body.data.week.hours).toBe(7)
    expect(response.body.data.recentEntries).toHaveLength(2)
    expect(mockList).toHaveBeenCalledWith(actor, expect.objectContaining({ limit: 20 }))
  })
})
