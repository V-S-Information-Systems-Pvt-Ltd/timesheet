import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActor, gate, verify, findSession, persistence } = vi.hoisted(() => ({
  getActor: vi.fn(), gate: vi.fn(), verify: vi.fn(), findSession: vi.fn(),
  persistence: {
    listActivityTypes: vi.fn(), createActivityType: vi.fn(), renameActivityType: vi.fn(),
    setActivityTypeActive: vi.fn(), setActivityTypeTelegramNo: vi.fn(), deleteActivityType: vi.fn(),
  },
}))
vi.mock('@/lib/auth', async () => ({ ...await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth'), getActor }))
vi.mock('@/lib/db/write-gate', () => ({ writeGateResponse: gate }))
vi.mock('@/lib/db/reference', () => ({ referenceDeps: () => ({ persistence }) }))
vi.mock('@/lib/auth/mobile-tokens', () => ({ verifyMobileAccessToken: verify, isLegacyMobileToken: vi.fn(async () => false) }))
vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { findSessionAndActorById: findSession } }))

import { POST } from '@/app/api/v1/admin/activity-types/route'
import { PATCH } from '@/app/api/v1/admin/activity-types/[id]/route'

const actor = {
  id: 'admin-1', email: 'admin@example.com', isActive: true,
  role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'user' as const,
}
const activity = { id: 'a1', name: 'Coding', is_active: true, telegram_no: null, created_at: '2026-09-26' }
const context = { params: Promise.resolve({ id: 'a1' }) }
const routes = [
  { method: 'POST', body: { name: ' Coding ' }, run: (request: Request) => POST(request), status: 201 },
  { method: 'PATCH', body: { operation: 'active', isActive: false }, run: (request: Request) => PATCH(request, context), status: 200 },
]
function request(method: string, body: unknown, headers: Record<string, string> = {}) {
  const suffix = method === 'PATCH' ? '/a1' : ''
  return new Request(`http://localhost:3000/api/v1/admin/activity-types${suffix}`, {
    method,
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', cookie: 'session=1', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}
function expectNoWrites() {
  expect(persistence.createActivityType).not.toHaveBeenCalled()
  expect(persistence.renameActivityType).not.toHaveBeenCalled()
  expect(persistence.setActivityTypeActive).not.toHaveBeenCalled()
  expect(persistence.setActivityTypeTelegramNo).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks()
  getActor.mockResolvedValue(actor)
  gate.mockResolvedValue(null)
  persistence.listActivityTypes.mockResolvedValue([activity])
  persistence.createActivityType.mockResolvedValue({ data: activity, error: null })
  for (const write of [persistence.renameActivityType, persistence.setActivityTypeActive, persistence.setActivityTypeTelegramNo]) {
    write.mockResolvedValue({ error: null })
  }
})

describe('browser activity-type guards', () => {
  for (const route of routes) {
    it(`${route.method} admits admin cookies with bearer auth disabled`, async () => {
      vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')
      try {
        expect((await route.run(request(route.method, route.body))).status).toBe(route.status)
        expect(verify).not.toHaveBeenCalled()
      } finally { vi.unstubAllEnvs() }
    })

    it(`${route.method} rejects PM, inactive and anonymous cookie actors`, async () => {
      getActor
        .mockResolvedValueOnce({ ...actor, role: 'pm', permission_role: 'pm' })
        .mockResolvedValueOnce({ ...actor, isActive: false })
        .mockResolvedValueOnce(null)
      expect((await route.run(request(route.method, route.body))).status).toBe(403)
      expect((await route.run(request(route.method, route.body))).status).toBe(403)
      expect((await route.run(request(route.method, route.body))).status).toBe(401)
      expectNoWrites()
    })

    it(`${route.method} rejects foreign origins and malformed bearer credentials before writes`, async () => {
      expect((await route.run(request(route.method, route.body, { origin: 'https://evil.example' }))).status).toBe(403)
      expect((await route.run(request(route.method, route.body, { authorization: 'invalid' }))).status).toBe(401)
      expect(getActor).not.toHaveBeenCalled()
      expectNoWrites()
    })

    it.each(['closed', 'unreadable'])(`${route.method} refuses a %s write fence`, async (state) => {
      if (state === 'closed') gate.mockResolvedValue({ status: 503, body: { error: 'Writers fenced.' } })
      else gate.mockRejectedValue(new Error('Gate unavailable'))
      const response = await route.run(request(route.method, route.body))
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('60')
      expectNoWrites()
    })
  }
})

describe('browser activity-type write parity', () => {
  it('creates by name only and acknowledges without a read-back', async () => {
    persistence.listActivityTypes.mockRejectedValue(new Error('Read-back unavailable'))
    const response = await POST(request('POST', { name: ' Coding ' }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ data: { success: true }, error: null })
    expect(persistence.createActivityType).toHaveBeenCalledWith(actor, 'Coding')
    expect(persistence.listActivityTypes).not.toHaveBeenCalled()
  })

  it('performs one narrow rename, active or Telegram write with no read-back', async () => {
    persistence.listActivityTypes.mockRejectedValue(new Error('Read-back unavailable'))
    expect((await PATCH(request('PATCH', { operation: 'rename', name: ' Review ' }), context)).status).toBe(200)
    expect(persistence.renameActivityType).toHaveBeenCalledWith(actor, 'a1', 'Review')
    expect((await PATCH(request('PATCH', { operation: 'active', isActive: false }), context)).status).toBe(200)
    expect(persistence.setActivityTypeActive).toHaveBeenCalledWith(actor, 'a1', false)
    expect((await PATCH(request('PATCH', { operation: 'telegram', telegramNo: 7 }), context)).status).toBe(200)
    expect(persistence.setActivityTypeTelegramNo).toHaveBeenCalledWith(actor, 'a1', 7)
    expect((await PATCH(request('PATCH', { operation: 'telegram', telegramNo: null }), context)).status).toBe(200)
    expect(persistence.setActivityTypeTelegramNo).toHaveBeenLastCalledWith(actor, 'a1', null)
    expect(persistence.listActivityTypes).not.toHaveBeenCalled()
  })

  it('rejects malformed, extra, multi-operation and invalid domain values', async () => {
    const invalid = [null, [], {}, { operation: 'rename' },
      { operation: 'active', isActive: 'false' },
      { operation: 'active', isActive: false, name: 'Injected' },
      { operation: 'telegram', telegramNo: 0 }, { operation: 'telegram', telegramNo: 1.5 }]
    for (const body of invalid) expect((await PATCH(request('PATCH', body), context)).status).toBe(400)
    expect((await POST(request('POST', { name: ' ', telegramNo: 7 }))).status).toBe(400)
    expectNoWrites()
  })

  it('preserves duplicate/provider errors', async () => {
    persistence.createActivityType.mockResolvedValue({ data: null, error: 'Activity type exists.' })
    const created = await POST(request('POST', { name: 'Coding' }))
    expect(created.status).toBe(409)
    expect(await created.json()).toMatchObject({ error: { message: 'Activity type exists.' } })
    persistence.setActivityTypeActive.mockResolvedValue({ error: 'Update refused.' })
    const updated = await PATCH(request('PATCH', { operation: 'active', isActive: false }), context)
    expect(updated.status).toBe(400)
    expect(await updated.json()).toMatchObject({ error: { message: 'Update refused.' } })
  })

  it('keeps bearer PATCH returning its row read-back', async () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    verify.mockResolvedValue({ userId: actor.id, sessionId: 's1', familyId: 'f1' })
    findSession.mockResolvedValue({
      actor,
      session: { id: 's1', userId: actor.id, familyId: 'f1', revokedAt: null, rotatedAt: null, idleExpiresAt: future, absoluteExpiresAt: future },
    })
    persistence.listActivityTypes.mockResolvedValue([{ ...activity, is_active: false }])
    const response = await PATCH(request('PATCH', { isActive: false }, { authorization: 'Bearer access' }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ...activity, is_active: false }, error: null })
    expect(getActor).not.toHaveBeenCalled()
    expect(persistence.listActivityTypes).toHaveBeenCalledTimes(1)
  })
})
