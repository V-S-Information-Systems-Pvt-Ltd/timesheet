// tests/reports-route.test.ts
// Regression test for the reports aggregation endpoint: from/to are DATES
// applied via repo dateFrom/dateTo (not pagination offsets), and groupBy is
// honored. This locks the Phase 4 fix for the offset-vs-date bug.
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/app/api/_http', () => ({
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  requireActive: vi.fn(),
  serverError: vi.fn((_err: unknown) => ({ error: 'internal' })),
}))

const { mockListTimesheets } = vi.hoisted(() => ({ mockListTimesheets: vi.fn() }))
vi.mock('@/lib/db', () => ({ repo: { listTimesheets: mockListTimesheets } }))

import { GET } from '../app/api/data/reports/route'
import { json, requireActive } from '@/app/api/_http'

type TestRow = {
  id: string
  user_id: string
  project_id: string
  activity_type_id: string
  log_date: string
  hours_worked: number
  profiles: { email: string } | null
  projects: { name: string } | null
  activity_types: { name: string } | null
}

const rows: TestRow[] = [
  { id: '1', user_id: 'u1', project_id: 'p1', activity_type_id: 'a1', log_date: '2026-01-05', hours_worked: 4, profiles: { email: 'a@x.com' }, projects: { name: 'Alpha' }, activity_types: { name: 'R&D' } },
  { id: '2', user_id: 'u2', project_id: 'p2', activity_type_id: 'a2', log_date: '2026-01-06', hours_worked: 6, profiles: { email: 'b@x.com' }, projects: { name: 'Beta' }, activity_types: { name: 'Dev' } },
  { id: '3', user_id: 'u1', project_id: 'p1', activity_type_id: 'a1', log_date: '2025-12-01', hours_worked: 2, profiles: { email: 'a@x.com' }, projects: { name: 'Alpha' }, activity_types: { name: 'R&D' } },
]

function req(qs: string): Request {
  return new Request(`http://localhost/api/data/reports${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireActive).mockResolvedValue({ ok: true, actor: { id: 'a1', email: 'a1@x.com', role: 'admin', permission_role: 'admin', hierarchy_role: 'user', isActive: true } })
  // Simulate the repository honouring dateFrom/dateTo (the route delegates date
  // filtering to the data layer).
  mockListTimesheets.mockImplementation((_actor, opts) => {
    const filtered = rows.filter(
      (r) =>
        (!opts?.dateFrom || r.log_date >= opts.dateFrom) &&
        (!opts?.dateTo || r.log_date <= opts.dateTo)
    )
    return Promise.resolve({ rows: filtered, count: filtered.length })
  })
})

describe('GET /api/data/reports', () => {
  it('passes dates to repo.dateFrom/dateTo, NOT as pagination offsets', async () => {
    const res = await GET(req('?from=2026-01-01&to=2026-01-31&project=p1&groupBy=user'))
    expect(mockListTimesheets).toHaveBeenCalledWith(
      expect.anything(),
      // The fix: from/to must surface as dateFrom/dateTo (date semantics).
      expect.objectContaining({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })
    )
    const { body } = res as unknown as { body: { data: { totalEntries: number } } }
    // Only rows within [2026-01-01, 2026-01-31] and project p1.
    expect(body.data.totalEntries).toBe(1)
  })

  it('aggregates by the requested groupBy', async () => {
    const res = await GET(req('?from=2026-01-01&to=2026-01-31&groupBy=project'))
    const { body } = res as unknown as { body: { data: { byGroup: Array<{ label: string; hours: number }> } } }
    expect(body.data.byGroup).toEqual([
      { label: 'Beta', hours: 6, entries: 1 },
      { label: 'Alpha', hours: 4, entries: 1 },
    ])
  })

  it('rejects an invalid date', async () => {
    await GET(req('?from=not-a-date'))
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('from') }), 400)
  })

  it('defaults groupBy to user when omitted', async () => {
    const res = await GET(req('?from=2026-01-01&to=2026-01-31'))
    const { body } = res as unknown as { body: { data: { byGroup: Array<{ label: string }> } } }
    expect(body.data.byGroup).toEqual(expect.arrayContaining([
      { label: 'a@x.com', hours: 4, entries: 1 },
      { label: 'b@x.com', hours: 6, entries: 1 },
    ]))
  })
})
