import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockTotals } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockTotals: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { error: { code, message } },
    status,
  })),
  serverError: vi.fn(() => ({ status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    getGroupedReportTotals: mockTotals,
  },
}))

import { GET } from '@/app/api/v1/reports/route'

const actor = { id: 'user-1', email: 'u@example.com', role: 'user', isActive: true }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
  mockTotals.mockResolvedValue([
    { label: 'Project Alpha', hours: 40, entries: 5 },
  ])
})

describe('/api/v1/reports', () => {
  it('returns grouped report totals on valid query', async () => {
    const response = (await GET(
      new Request('http://localhost/api/v1/reports?from=2026-08-01&to=2026-08-31&groupBy=project')
    )) as unknown as {
      status: number
      body: { data: { totalHours: number; totalEntries: number; byGroup: Array<{ label: string; hours: number; entries: number }> } }
    }

    expect(response.status).toBe(200)
    expect(response.body.data.totalHours).toBe(40)
    expect(response.body.data.totalEntries).toBe(5)
    expect(response.body.data.byGroup[0]).toEqual({ label: 'Project Alpha', hours: 40, entries: 5 })
    expect(mockTotals).toHaveBeenCalledWith(
      actor,
      { projectId: undefined, from: '2026-08-01', to: '2026-08-31' },
      'project'
    )
  })

  it('rejects invalid dates with 400', async () => {
    const response = (await GET(
      new Request('http://localhost/api/v1/reports?from=invalid-date')
    )) as unknown as { status: number }

    expect(response.status).toBe(400)
    expect(mockTotals).not.toHaveBeenCalled()
  })
})
