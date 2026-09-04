import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockListTimesheets } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockListTimesheets: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, init?: number | { status?: number }) => {
    const status = typeof init === 'number' ? init : init?.status ?? 200
    return { body, status }
  }),
  badRequest: vi.fn((message: string) => ({ body: { error: { code: 'BAD_REQUEST', message } }, status: 400 })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { error: { code, message } },
    status,
  })),
  serverError: vi.fn((err: unknown) => ({ body: { error: err }, status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    listTimesheets: mockListTimesheets,
  },
}))

import { GET as exportCsvRoute } from '@/app/api/v1/reports/export/route'

describe('Slice 12: Mobile Privileged Reports & CSV Export Route', () => {
  const adminActor = {
    id: 'u-admin',
    email: 'admin@vsis.lk',
    role: 'admin' as const,
    permission_role: 'admin' as const,
    hierarchy_role: 'manager' as const,
    isActive: true,
  }

  const leaderActor = {
    id: 'u-lead',
    email: 'leader@vsis.lk',
    role: 'user' as const,
    permission_role: 'user' as const,
    hierarchy_role: 'team_lead' as const,
    isActive: true,
  }

  const userActor = {
    id: 'u-user',
    email: 'user@vsis.lk',
    role: 'user' as const,
    permission_role: 'user' as const,
    hierarchy_role: 'engineer' as const,
    isActive: true,
  }

  const mockRows = [
    {
      id: 't-1',
      user_id: 'u-user',
      profiles: { email: 'user@vsis.lk' },
      project_id: 'p-1',
      projects: { name: 'Project Alpha' },
      activity_type_id: 'a-1',
      activity_types: { name: 'Dev' },
      log_date: '2026-08-30',
      hours_worked: 7.5,
      work_done: 'Implemented privileged reports & export feature',
      created_at: '2026-08-30T10:00:00Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockRequire.mockResolvedValue({ ok: true, actor: adminActor })
    mockListTimesheets.mockResolvedValue({ rows: mockRows, count: 1 })
  })

  it('exports timesheets as streamed CSV attachment for admin', async () => {
    const req = new Request('http://localhost/api/v1/reports/export?from=2026-08-01&to=2026-08-31')
    const res = await exportCsvRoute(req)

    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="timesheets_20260801_20260831.csv"')
    expect(res.headers.get('X-Total-Count')).toBe('1')

    const text = await res.text()
    expect(text).toContain('Date,User,Project,Type,Hours,Work Done')
    expect(text).toContain('2026-08-30,user@vsis.lk,Project Alpha,Dev,7.5,Implemented privileged reports & export feature')
  })

  it('allows leader to filter by team member', async () => {
    mockRequire.mockResolvedValueOnce({ ok: true, actor: leaderActor })
    const req = new Request('http://localhost/api/v1/reports/export?user=u-user&from=2026-08-01&to=2026-08-31')
    const res = await exportCsvRoute(req)
    expect(res.status).toBe(200)
    expect(mockListTimesheets).toHaveBeenCalledWith(
      leaderActor,
      expect.objectContaining({
        userId: 'u-user',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
      })
    )
  })

  it('constrains regular user export to their own user_id even if requesting another user', async () => {
    mockRequire.mockResolvedValueOnce({ ok: true, actor: userActor })
    const req = new Request('http://localhost/api/v1/reports/export?user=u-admin&from=2026-08-01&to=2026-08-31')
    const res = await exportCsvRoute(req)
    expect(res.status).toBe(200)
    expect(mockListTimesheets).toHaveBeenCalledWith(
      userActor,
      expect.objectContaining({
        userId: 'u-user',
      })
    )
  })

  it('neutralizes formula injection characters in user text cells', async () => {
    mockListTimesheets.mockResolvedValueOnce({
      rows: [
        {
          id: 't-inj',
          user_id: 'u-user',
          profiles: { email: '=cmd|/c calc!A0' },
          project_id: 'p-1',
          projects: { name: '+SUM(1,2)' },
          activity_type_id: 'a-1',
          activity_types: { name: '-2+3' },
          log_date: '2026-08-30',
          hours_worked: 5,
          work_done: '@evil_formula',
          created_at: '2026-08-30T10:00:00Z',
        },
      ],
      count: 1,
    })

    const req = new Request('http://localhost/api/v1/reports/export?from=2026-08-01&to=2026-08-31')
    const res = await exportCsvRoute(req)
    const text = await res.text()

    expect(text).toContain("'=cmd|/c calc!A0")
    expect(text).toContain("'+SUM(1,2)")
    expect(text).toContain("'-2+3")
    expect(text).toContain("'@evil_formula")
  })

  it('returns 204 No Content with X-Total-Count: 0 when no rows are found', async () => {
    mockListTimesheets.mockResolvedValueOnce({ rows: [], count: 0 })

    const req = new Request('http://localhost/api/v1/reports/export?from=2026-08-01&to=2026-08-31')
    const res = await exportCsvRoute(req)
    expect(res.status).toBe(204)
    expect(res.headers.get('X-Total-Count')).toBe('0')
  })

  it('rejects invalid date format with 400', async () => {
    const req = new Request('http://localhost/api/v1/reports/export?from=invalid-date')
    const res = (await exportCsvRoute(req)) as unknown as { status: number }
    expect(res.status).toBe(400)
  })
})
