// tests/timesheets-api.test.ts
// Tests for the timesheets API route handler: pagination param parsing,
// authorization gating, and response shape.
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  repo: {
    listTimesheets: vi.fn(),
  },
}))

vi.mock('@/app/api/_http', () => ({
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  requireActive: vi.fn(),
  serverError: (_err: unknown) => new Response(JSON.stringify({ error: 'Server error' }), { status: 500 }),
}))

import { GET } from '../app/api/data/timesheets/route'
import { repo } from '@/lib/db'
import { requireActive } from '@/app/api/_http'

const mockRepo = repo as unknown as { listTimesheets: ReturnType<typeof vi.fn> }
const mockRequireActive = requireActive as ReturnType<typeof vi.fn>

function buildRequest(search: string): Request {
  return new Request(`http://localhost/api/data/timesheets${search}`, { method: 'GET' })
}

describe('GET /api/data/timesheets', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequireActive.mockResolvedValue({ ok: true, actor: { id: 'user-1', role: 'user', isActive: true } })
  })

  it('returns 400 for non-integer from', async () => {
    const res = await GET(buildRequest('?from=abc'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('from')
  })

  it('returns 400 for negative from', async () => {
    const res = await GET(buildRequest('?from=-1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('from')
  })

  it('returns 400 for non-integer limit', async () => {
    const res = await GET(buildRequest('?limit=foo'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('limit')
  })

  it.each(['dateFrom', 'dateTo'])('returns 400 for a malformed %s instead of a backend date error', async (param) => {
    mockRepo.listTimesheets.mockResolvedValueOnce({ rows: [], count: 0 })
    const res = await GET(buildRequest(`?${param}=not-a-date`))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(new RegExp(param, 'i'))
    // The repo must never see the malformed value
    expect(mockRepo.listTimesheets).not.toHaveBeenCalled()
  })

  it('maps valid dateFrom/dateTo through to the repo', async () => {
    mockRepo.listTimesheets.mockResolvedValueOnce({ rows: [], count: 0 })
    const res = await GET(buildRequest('?dateFrom=2026-01-01&dateTo=2026-01-31'))
    expect(res.status).toBe(200)
    expect(mockRepo.listTimesheets).toHaveBeenCalledWith(
      { id: 'user-1', role: 'user', isActive: true },
      { dateFrom: '2026-01-01', dateTo: '2026-01-31' }
    )
  })

  it('maps from/to/limit to repo.listTimesheets', async () => {
    mockRepo.listTimesheets.mockResolvedValueOnce({ rows: [], count: 0 })
    const res = await GET(buildRequest('?from=0&to=49&limit=50'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual([])
    expect(body.count).toBe(0)
    expect(mockRepo.listTimesheets).toHaveBeenCalledWith(
      { id: 'user-1', role: 'user', isActive: true },
      { from: 0, to: 49, limit: 50 }
    )
  })

  it('omits pagination opts when params are absent', async () => {
    mockRepo.listTimesheets.mockResolvedValueOnce({ rows: [], count: 0 })
    const res = await GET(buildRequest(''))
    expect(res.status).toBe(200)
    expect(mockRepo.listTimesheets).toHaveBeenCalledWith(
      { id: 'user-1', role: 'user', isActive: true },
      {}
    )
  })

  it('returns 401 when requireActive rejects', async () => {
    mockRequireActive.mockResolvedValueOnce({ ok: false, response: new Response('Unauthorized', { status: 401 }) })
    const res = await GET(buildRequest(''))
    expect(res.status).toBe(401)
  })
})
