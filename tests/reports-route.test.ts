// tests/reports-route.test.ts
// Regression test for the reports aggregation endpoint, which now aggregates
// with GROUP BY on the server via repo.getGroupedReportTotals (Phase 4.5)
// instead of shipping every row and summing in JS. The route passes through
// the date range (as from/to), the project filter, and the requested groupBy.
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/app/api/_http', () => ({
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  requireActive: vi.fn(),
  serverError: vi.fn((_err: unknown) => ({ error: 'internal' })),
}))

const { mockGetGroupedReportTotals } = vi.hoisted(() => ({ mockGetGroupedReportTotals: vi.fn() }))
vi.mock('@/lib/db', () => ({ repo: { getGroupedReportTotals: mockGetGroupedReportTotals } }))

import { GET } from '../app/api/data/reports/route'
import { json, requireActive } from '@/app/api/_http'

function req(qs: string): Request {
  return new Request(`http://localhost/api/data/reports${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireActive).mockResolvedValue({ ok: true, actor: { id: 'a1', email: 'a1@x.com', role: 'admin', permission_role: 'admin', hierarchy_role: 'user', isActive: true } })
  mockGetGroupedReportTotals.mockResolvedValue([
    { label: 'Alpha', hours: 4, entries: 1 },
    { label: 'Beta', hours: 6, entries: 1 },
  ])
})

describe('GET /api/data/reports', () => {
  it('passes the date range, project and groupBy to the grouped repo method', async () => {
    await GET(req('?from=2026-01-01&to=2026-01-31&project=p1&groupBy=project'))
    expect(mockGetGroupedReportTotals).toHaveBeenCalledWith(
      expect.anything(),
      // from/to must surface as date filters (not pagination offsets).
      expect.objectContaining({ projectId: 'p1', from: '2026-01-01', to: '2026-01-31' }),
      'project'
    )
  })

  it('aggregates via the grouped method and returns totals', async () => {
    const res = await GET(req('?groupBy=project&from=2026-01-01&to=2026-01-31'))
    const { body } = res as unknown as { body: { data: { totalHours: number; totalEntries: number; byGroup: Array<unknown> } } }
    expect(body.data.totalHours).toBe(10)
    expect(body.data.totalEntries).toBe(2)
    expect(body.data.byGroup).toEqual([
      { label: 'Alpha', hours: 4, entries: 1 },
      { label: 'Beta', hours: 6, entries: 1 },
    ])
  })

  it('rejects an invalid date', async () => {
    await GET(req('?from=not-a-date'))
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('from') }), 400)
  })

  it('defaults groupBy to user when omitted', async () => {
    await GET(req('?from=2026-01-01&to=2026-01-31'))
    expect(mockGetGroupedReportTotals).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ from: '2026-01-01', to: '2026-01-31' }),
      'user'
    )
  })

  it('rejects an unknown groupBy', async () => {
    await GET(req('?from=2026-01-01&to=2026-01-31&groupBy=bogus'))
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('groupBy') }), 400)
  })
})