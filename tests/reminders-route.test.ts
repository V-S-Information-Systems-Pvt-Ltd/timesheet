// tests/reminders-route.test.ts
// POST/PATCH /api/data/reminders boundary validation: message/time rules
// (mirroring the global-reminder Server Action), id requirement, auth gating.
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  repo: {
    createReminder: vi.fn(),
    updateReminder: vi.fn(),
  },
}))

vi.mock('@/app/api/_http', () => ({
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  requireActive: vi.fn(),
  serverError: (_err: unknown) => new Response(JSON.stringify({ error: 'Server error' }), { status: 500 }),
}))

import { PATCH, POST } from '../app/api/data/reminders/route'
import { repo } from '@/lib/db'
import { requireActive } from '@/app/api/_http'

const mockRepo = repo as unknown as {
  createReminder: ReturnType<typeof vi.fn>
  updateReminder: ReturnType<typeof vi.fn>
}
const mockRequireActive = requireActive as ReturnType<typeof vi.fn>

function req(body: unknown, method = 'POST'): Request {
  return new Request('http://localhost/api/data/reminders', {
    method,
    body: JSON.stringify(body),
  }) as Request
}

beforeEach(() => {
  vi.resetAllMocks()
  mockRequireActive.mockResolvedValue({ ok: true, actor: { id: 'user-1', isActive: true } })
})

describe('POST /api/data/reminders', () => {
  it('returns 401 when requireActive rejects', async () => {
    mockRequireActive.mockResolvedValueOnce({ ok: false, response: new Response('denied', { status: 403 }) })
    const res = await POST(req({ message: 'm', remindAt: '2026-01-01T10:00' }))
    expect(res.status).toBe(403)
    expect(mockRepo.createReminder).not.toHaveBeenCalled()
  })

  it.each([
    [{ remindAt: '2026-01-01T10:00' }, /message/i],
    [{ message: 'm' }, /remindAt/i],
    [{ message: 'm', remindAt: 'not-a-date' }, /Invalid reminder time/],
    [{ message: ' ', remindAt: '2026-01-01T10:00' }, /Message is required/],
  ])('returns 400 with a field error for %j', async (body, matches) => {
    const res = await POST(req(body))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(matches as RegExp)
    expect(mockRepo.createReminder).not.toHaveBeenCalled()
  })

  it('returns 400 for messages over 500 characters', async () => {
    const res = await POST(req({ message: 'x'.repeat(501), remindAt: '2026-01-01T10:00' }))
    expect(res.status).toBe(400)
    expect(mockRepo.createReminder).not.toHaveBeenCalled()
  })

  it('normalizes remindAt to ISO and passes the session user through', async () => {
    mockRepo.createReminder.mockResolvedValueOnce({ error: null })
    const res = await POST(req({ message: 'hello', remindAt: '2026-01-01T10:00' }))
    expect(res.status).toBe(200)
    expect(mockRepo.createReminder).toHaveBeenCalledWith(
      { id: 'user-1', isActive: true },
      { userId: 'user-1', message: 'hello', remindAt: new Date('2026-01-01T10:00').toISOString() }
    )
  })
})

describe('PATCH /api/data/reminders', () => {
  it('returns 400 when the id is missing or blank', async () => {
    for (const body of [{ done: true }, { id: '   ', done: true }, {}]) {
      const res = await PATCH(req(body, 'PATCH'))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/id/i)
    }
    expect(mockRepo.updateReminder).not.toHaveBeenCalled()
  })

  it('passes a valid toggle through to the repo', async () => {
    mockRepo.updateReminder.mockResolvedValueOnce({ error: null })
    const res = await PATCH(req({ id: 'r1', done: true }, 'PATCH'))
    expect(res.status).toBe(200)
    expect(mockRepo.updateReminder).toHaveBeenCalledWith(
      { id: 'user-1', isActive: true },
      'r1',
      { done: true }
    )
  })
})
