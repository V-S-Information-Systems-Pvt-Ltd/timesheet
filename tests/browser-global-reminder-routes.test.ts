import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActor, gate, verify, findSession, persistence } = vi.hoisted(() => ({
  getActor: vi.fn(), gate: vi.fn(), verify: vi.fn(), findSession: vi.fn(),
  persistence: {
    createGlobalReminder: vi.fn(), deleteGlobalReminder: vi.fn(), dismissGlobalReminder: vi.fn(),
  },
}))
vi.mock('@/lib/auth', async () => ({ ...await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth'), getActor }))
vi.mock('@/lib/db/write-gate', () => ({ writeGateResponse: gate }))
vi.mock('@/lib/db/leave-reminders', () => ({ leaveReminderDeps: () => ({ persistence }) }))
vi.mock('@/lib/auth/mobile-tokens', () => ({ verifyMobileAccessToken: verify, isLegacyMobileToken: vi.fn(async () => false) }))
vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { findSessionAndActorById: findSession } }))

import { POST as createReminder } from '@/app/api/v1/admin/global-reminders/route'
import { DELETE as deleteReminder } from '@/app/api/v1/admin/global-reminders/[id]/route'
import { POST as dismissReminder } from '@/app/api/v1/reminders/global/[id]/dismiss/route'

const admin = {
  id: 'admin-1', email: 'admin@example.com', isActive: true,
  role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'user' as const,
}
const reminder = { id: 'g1', message: 'Submit sheets', remind_at: '2026-10-01T12:00:00.000Z', created_at: '' }
const context = { params: Promise.resolve({ id: 'g1' }) }
function request(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', cookie: 'session=1', 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const createBody = { message: ' Submit sheets ', remindAt: '2026-10-01T12:00:00.000Z' }
const routes = [
  { run: () => createReminder(request('/api/v1/admin/global-reminders', 'POST', createBody)), write: persistence.createGlobalReminder },
  { run: () => deleteReminder(request('/api/v1/admin/global-reminders/g1', 'DELETE'), context), write: persistence.deleteGlobalReminder },
  { run: () => dismissReminder(request('/api/v1/reminders/global/g1/dismiss', 'POST'), context), write: persistence.dismissGlobalReminder },
]
beforeEach(() => {
  vi.resetAllMocks()
  getActor.mockResolvedValue(admin)
  gate.mockResolvedValue(null)
  persistence.createGlobalReminder.mockResolvedValue({ data: null, error: null })
  persistence.deleteGlobalReminder.mockResolvedValue({ error: null })
  persistence.dismissGlobalReminder.mockResolvedValue({ error: null })
})

describe('browser global-reminder guards', () => {
  for (const [index, route] of routes.entries()) {
    it(`admits route ${index + 1} cookies with bearer auth disabled`, async () => {
      vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')
      try {
        expect((await route.run()).status).toBe(index === 0 ? 200 : 200)
        expect(verify).not.toHaveBeenCalled()
      } finally { vi.unstubAllEnvs() }
    })

    it(`rejects route ${index + 1} inactive, anonymous, foreign-origin and malformed bearer requests`, async () => {
      getActor.mockResolvedValueOnce({ ...admin, isActive: false }).mockResolvedValueOnce(null)
      expect((await route.run()).status).toBe(403)
      expect((await route.run()).status).toBe(401)
      const original = routes[index]
      const path = index === 0 ? '/api/v1/admin/global-reminders' : index === 1 ? '/api/v1/admin/global-reminders/g1' : '/api/v1/reminders/global/g1/dismiss'
      const method = index === 1 ? 'DELETE' : 'POST'
      const body = index === 0 ? createBody : undefined
      const foreign = request(path, method, body, { origin: 'https://evil.example' })
      const bearer = request(path, method, body, { authorization: 'invalid' })
      const run = index === 0 ? (r: Request) => createReminder(r) : index === 1 ? (r: Request) => deleteReminder(r, context) : (r: Request) => dismissReminder(r, context)
      expect((await run(foreign)).status).toBe(403)
      expect((await run(bearer)).status).toBe(401)
      expect(original.write).not.toHaveBeenCalled()
    })

    it.each(['closed', 'unreadable'])(`route ${index + 1} refuses a %s write fence`, async (state) => {
      if (state === 'closed') gate.mockResolvedValue({ status: 503, body: { error: 'Writers fenced.' } })
      else gate.mockRejectedValue(new Error('Gate unavailable'))
      const response = await route.run()
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('60')
      expect(route.write).not.toHaveBeenCalled()
    })
  }
})

describe('browser global-reminder parity', () => {
  it('normalizes create input and acknowledges without requiring an inserted row', async () => {
    const response = await createReminder(request('/api/v1/admin/global-reminders', 'POST', createBody))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { success: true }, error: null })
    expect(persistence.createGlobalReminder).toHaveBeenCalledWith(admin, {
      message: 'Submit sheets', remindAt: '2026-10-01T12:00:00.000Z',
    })
  })

  it('rejects non-admin create/delete but permits active ordinary-user dismissal', async () => {
    getActor.mockResolvedValue({ ...admin, role: 'user', permission_role: 'user' })
    expect((await createReminder(request('/api/v1/admin/global-reminders', 'POST', createBody))).status).toBe(403)
    expect((await deleteReminder(request('/api/v1/admin/global-reminders/g1', 'DELETE'), context)).status).toBe(403)
    expect((await dismissReminder(request('/api/v1/reminders/global/g1/dismiss', 'POST'), context)).status).toBe(200)
    expect(persistence.dismissGlobalReminder).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), 'g1')
  })

  it('rejects malformed, extra, missing and invalid-date create input', async () => {
    for (const body of [null, [], {}, { message: 'x' }, { message: 'x', remindAt: 'bad' },
      { message: 'x', remindAt: reminder.remind_at, injected: true }]) {
      expect((await createReminder(request('/api/v1/admin/global-reminders', 'POST', body))).status).toBe(400)
    }
    expect(persistence.createGlobalReminder).not.toHaveBeenCalled()
  })

  it('surfaces provider errors and preserves repeat-dismiss handling', async () => {
    persistence.deleteGlobalReminder.mockResolvedValue({ error: 'Delete refused.' })
    expect((await deleteReminder(request('/api/v1/admin/global-reminders/g1', 'DELETE'), context)).status).toBe(400)
    persistence.dismissGlobalReminder.mockResolvedValue({ error: 'Already dismissed.' })
    const response = await dismissReminder(request('/api/v1/reminders/global/g1/dismiss', 'POST'), context)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { message: 'Already dismissed.' } })
  })

  it('keeps bearer create returning the inserted reminder DTO', async () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    verify.mockResolvedValue({ userId: admin.id, sessionId: 's1', familyId: 'f1' })
    findSession.mockResolvedValue({
      actor: admin,
      session: { id: 's1', userId: admin.id, familyId: 'f1', revokedAt: null, rotatedAt: null, idleExpiresAt: future, absoluteExpiresAt: future },
    })
    persistence.createGlobalReminder.mockResolvedValue({ data: reminder, error: null })
    const response = await createReminder(request('/api/v1/admin/global-reminders', 'POST', createBody, { authorization: 'Bearer access' }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ data: reminder, error: null })
  })
})
