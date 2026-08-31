// tests/reports-export-route.test.ts
// Tests for the streaming CSV export endpoint GET /api/data/reports/export

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/app/api/_http', () => ({
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  requireActive: vi.fn(),
  serverError: vi.fn((_err: unknown) => ({ error: 'internal' })),
}))

const { mockListTimesheets } = vi.hoisted(() => ({ mockListTimesheets: vi.fn() }))
vi.mock('@/lib/db', () => ({ repo: { listTimesheets: mockListTimesheets } }))

import { GET } from '../app/api/data/reports/export/route'
import { json, requireActive } from '@/app/api/_http'

function req(qs: string): Request {
  return new Request(`http://localhost/api/data/reports/export${qs}`)
}

async function readStreamText(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let result = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  result += decoder.decode()
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireActive).mockResolvedValue({
    ok: true,
    actor: { id: 'admin-1', email: 'admin@vsis.lk', role: 'admin', permission_role: 'admin', hierarchy_role: 'user', isActive: true },
  })
})

describe('GET /api/data/reports/export', () => {
  it('rejects unauthenticated requests', async () => {
    vi.mocked(requireActive).mockResolvedValueOnce({
      ok: false,
      response: { body: { error: 'Unauthorized' }, status: 401 } as unknown as Response,
    })

    const res = await GET(req(''))
    expect(res).toEqual({ body: { error: 'Unauthorized' }, status: 401 })
  })

  it('rejects invalid "from" date', async () => {
    await GET(req('?from=invalid-date'))
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('from') }), 400)
  })

  it('rejects invalid "to" date', async () => {
    await GET(req('?to=2026-99-99'))
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('to') }), 400)
  })

  it('streams CSV headers and rows with Content-Disposition attachment', async () => {
    mockListTimesheets.mockResolvedValueOnce({
      rows: [
        {
          id: 't-1',
          user_id: 'u-1',
          project_id: 'p-1',
          activity_type_id: 'a-1',
          log_date: '2026-01-15',
          hours_worked: 8,
          work_done: 'Implemented streaming export, "tested" features',
          profiles: { email: 'dev@vsis.lk' },
          projects: { name: 'Portal' },
          activity_types: { name: 'Development' },
        },
      ],
      count: 1,
    })

    const res = await GET(req('?from=2026-01-01&to=2026-01-31&project=p-1&user=u-1'))
    expect(res).toBeInstanceOf(Response)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="timesheets_20260101_20260131.csv"')

    const bodyText = await readStreamText(res)
    expect(bodyText).toContain('Date,User,Project,Type,Hours,Work Done')
    expect(bodyText).toContain('2026-01-15,dev@vsis.lk,Portal,Development,8,"Implemented streaming export, ""tested"" features"')
  })

  it('streams multi-page rows across chunks (500 + 1 rows)', async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => ({
      id: `t-${i}`,
      user_id: 'u-1',
      project_id: 'p-1',
      activity_type_id: 'a-1',
      log_date: '2026-01-10',
      hours_worked: 1,
      work_done: `Task ${i}`,
      profiles: { email: 'user@vsis.lk' },
      projects: { name: 'Platform' },
      activity_types: { name: 'Dev' },
    }))

    const page2 = [
      {
        id: 't-500',
        user_id: 'u-1',
        project_id: 'p-1',
        activity_type_id: 'a-1',
        log_date: '2026-01-11',
        hours_worked: 2,
        work_done: 'Task 500',
        profiles: { email: 'user@vsis.lk' },
        projects: { name: 'Platform' },
        activity_types: { name: 'Dev' },
      },
    ]

    mockListTimesheets
      .mockResolvedValueOnce({ rows: page1, count: 501 })
      .mockResolvedValueOnce({ rows: page2, count: 501 })

    const res = await GET(req('?from=2026-01-01&to=2026-01-31'))
    const bodyText = await readStreamText(res)

    const lines = bodyText.trim().split('\n')
    // 1 header line + 500 rows + 1 row = 502 lines
    expect(lines.length).toBe(502)
    expect(lines[0]).toBe('Date,User,Project,Type,Hours,Work Done')
    expect(lines[1]).toContain('Task 0')
    expect(lines[501]).toContain('Task 500')

    expect(mockListTimesheets).toHaveBeenCalledTimes(2)
    expect(mockListTimesheets).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ from: 0, to: 499, includeCount: false })
    )
    expect(mockListTimesheets).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ from: 500, to: 999, includeCount: false })
    )
  })

  it('enforces self-user filter for regular users', async () => {
    vi.mocked(requireActive).mockResolvedValueOnce({
      ok: true,
      actor: { id: 'user-regular', email: 'regular@vsis.lk', role: 'user', permission_role: 'user', hierarchy_role: 'user', isActive: true },
    })

    mockListTimesheets.mockResolvedValueOnce({ rows: [], count: 0 })

    await GET(req('?user=other-user-id'))

    expect(mockListTimesheets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-regular' })
    )
  })

  it('streams only header when 0 rows are returned', async () => {
    mockListTimesheets.mockResolvedValueOnce({ rows: [], count: 0 })

    const res = await GET(req('?from=2026-01-01&to=2026-01-31'))
    const bodyText = await readStreamText(res)

    const lines = bodyText.trim().split('\n')
    expect(lines.length).toBe(1)
    expect(lines[0]).toBe('Date,User,Project,Type,Hours,Work Done')
    expect(mockListTimesheets).toHaveBeenCalledTimes(1)
  })

  it('passes project filter to listTimesheets', async () => {
    mockListTimesheets.mockResolvedValueOnce({ rows: [], count: 0 })

    await GET(req('?from=2026-01-01&to=2026-01-31&project=proj-123'))

    expect(mockListTimesheets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: 'proj-123' })
    )
  })

  it('handles stream errors if repo throws on a subsequent page', async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => ({
      id: `t-${i}`,
      user_id: 'u-1',
      project_id: 'p-1',
      activity_type_id: 'a-1',
      log_date: '2026-01-10',
      hours_worked: 1,
      work_done: `Task ${i}`,
      profiles: { email: 'user@vsis.lk' },
      projects: { name: 'Platform' },
      activity_types: { name: 'Dev' },
    }))

    mockListTimesheets
      .mockResolvedValueOnce({ rows: page1, count: 600 })
      .mockRejectedValueOnce(new Error('Database disconnect during stream'))

    const res = await GET(req('?from=2026-01-01&to=2026-01-31'))
    await expect(readStreamText(res)).rejects.toThrow('Database disconnect during stream')
  })
})
