// tests/leaves-route.test.ts
// POST /api/data/leaves boundary validation: row shape, ISO dates, row-count
// cap, and auth gating. Malformed input must return a clean 400 and never
// reach the repository layer.
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  repo: {
    listLeaves: vi.fn(),
    createLeaves: vi.fn(),
  },
}))

vi.mock('@/app/api/_http', () => ({
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  requireActive: vi.fn(),
  serverError: (_err: unknown) => new Response(JSON.stringify({ error: 'Server error' }), { status: 500 }),
}))

import { GET, POST } from '../app/api/data/leaves/route'
import { repo } from '@/lib/db'
import { requireActive } from '@/app/api/_http'

const mockRepo = repo as unknown as { listLeaves: ReturnType<typeof vi.fn>; createLeaves: ReturnType<typeof vi.fn> }
const mockRequireActive = requireActive as ReturnType<typeof vi.fn>

function req(body: unknown): Request {
  return new Request('http://localhost/api/data/leaves', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as Request
}

beforeEach(() => {
  vi.resetAllMocks()
  mockRequireActive.mockResolvedValue({ ok: true, actor: { id: 'user-1', isActive: true } })
})

describe('POST /api/data/leaves', () => {
  it('returns 401 when requireActive rejects', async () => {
    mockRequireActive.mockResolvedValueOnce({ ok: false, response: new Response('denied', { status: 403 }) })
    const res = await POST(req({ rows: [] }))
    expect(res.status).toBe(403)
    expect(mockRepo.createLeaves).not.toHaveBeenCalled()
  })

  it('returns 400 when rows is missing or not an array', async () => {
    for (const body of [{}, { rows: 'nope' }, { rows: null }]) {
      const res = await POST(req(body))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBeTruthy()
    }
    expect(mockRepo.createLeaves).not.toHaveBeenCalled()
  })

  it.each(['userId', 'leaveDate'])('returns 400 when a row is missing %s', async (field) => {
    const row = { userId: 'user-1', leaveDate: '2026-01-04', reason: 'vacation' }
    delete (row as Record<string, unknown>)[field]
    const res = await POST(req({ rows: [row] }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain(field)
    expect(mockRepo.createLeaves).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed leave date instead of a backend error', async () => {
    const res = await POST(req({ rows: [{ userId: 'user-1', leaveDate: 'tomorrow', reason: 'x' }] }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/leaveDate/)
    expect(mockRepo.createLeaves).not.toHaveBeenCalled()
  })

  it('returns 400 above the 366-row cap', async () => {
    const rows = Array.from({ length: 367 }, (_, i) => ({
      userId: 'user-1',
      leaveDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      reason: '',
    }))
    const res = await POST(req({ rows }))
    expect(res.status).toBe(400)
    expect(mockRepo.createLeaves).not.toHaveBeenCalled()
  })

  it('passes validated rows through to the repo', async () => {
    mockRepo.createLeaves.mockResolvedValueOnce({ error: null })
    const rows = [{ userId: 'user-1', leaveDate: '2026-01-04', reason: 'vacation' }]
    const res = await POST(req({ rows }))
    expect(res.status).toBe(200)
    expect(mockRepo.createLeaves).toHaveBeenCalledWith(
      { id: 'user-1', isActive: true },
      rows
    )
  })
})

describe('GET /api/data/leaves', () => {
  it('returns 400 for malformed date filters instead of a backend date error', async () => {
    for (const param of ['from', 'to']) {
      const res = await GET(new Request(`http://localhost/api/data/leaves?${param}=not-a-date`))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(new RegExp(param, 'i'))
    }
    expect(mockRepo.listLeaves).not.toHaveBeenCalled()
  })

  it('passes valid date filters through to the repository', async () => {
    mockRepo.listLeaves.mockResolvedValueOnce([])
    const res = await GET(new Request('http://localhost/api/data/leaves?from=2026-01-01&to=2026-01-31'))
    expect(res.status).toBe(200)
    expect(mockRepo.listLeaves).toHaveBeenCalledWith(
      { id: 'user-1', isActive: true },
      { from: '2026-01-01', to: '2026-01-31' }
    )
  })
})
