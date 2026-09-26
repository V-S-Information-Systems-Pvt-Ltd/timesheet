import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActor, gate, verify, findSession, persistence } = vi.hoisted(() => ({
  getActor: vi.fn(), gate: vi.fn(), verify: vi.fn(), findSession: vi.fn(),
  persistence: {
    listProjects: vi.fn(), createProject: vi.fn(), renameProject: vi.fn(),
    setProjectSO: vi.fn(), setProjectTelegramNo: vi.fn(), deleteProject: vi.fn(),
  },
}))
vi.mock('@/lib/auth', async () => ({ ...await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth'), getActor }))
vi.mock('@/lib/db/write-gate', () => ({ writeGateResponse: gate }))
vi.mock('@/lib/db/reference', () => ({ referenceDeps: () => ({ persistence }) }))
vi.mock('@/lib/auth/mobile-tokens', () => ({ verifyMobileAccessToken: verify, isLegacyMobileToken: vi.fn(async () => false) }))
vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { findSessionAndActorById: findSession } }))

import { GET, POST } from '@/app/api/v1/admin/projects/route'
import { PATCH, DELETE } from '@/app/api/v1/admin/projects/[id]/route'

const actor = {
  id: 'pm-1', email: 'pm@example.com', isActive: true,
  role: 'pm' as const, permission_role: 'pm' as const, hierarchy_role: 'user' as const,
}
const project = { id: 'p1', name: 'Alpha', so_number: null, telegram_no: null, created_at: '2026-09-26' }
const context = { params: Promise.resolve({ id: 'p1' }) }
const routes = [
  { method: 'GET', path: '', body: undefined, run: GET, status: 200 },
  { method: 'POST', path: '', body: { name: ' Alpha ' }, run: POST, status: 201 },
  { method: 'PATCH', path: '/p1', body: { name: ' Beta ' }, run: (request: Request) => PATCH(request, context), status: 200 },
  { method: 'DELETE', path: '/p1', body: undefined, run: (request: Request) => DELETE(request, context), status: 200 },
]
function request(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000/api/v1/admin/projects${method === 'PATCH' || method === 'DELETE' ? '/p1' : ''}`, {
    method,
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', cookie: 'session=1', 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function expectNoWrites() {
  expect(persistence.createProject).not.toHaveBeenCalled()
  expect(persistence.renameProject).not.toHaveBeenCalled()
  expect(persistence.setProjectSO).not.toHaveBeenCalled()
  expect(persistence.setProjectTelegramNo).not.toHaveBeenCalled()
  expect(persistence.deleteProject).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks()
  getActor.mockResolvedValue(actor)
  gate.mockResolvedValue(null)
  persistence.listProjects.mockResolvedValue([project])
  persistence.createProject.mockResolvedValue({ data: project, error: null })
  for (const write of [persistence.renameProject, persistence.setProjectSO, persistence.setProjectTelegramNo, persistence.deleteProject]) {
    write.mockResolvedValue({ error: null })
  }
})

describe('browser project administration guards and policy', () => {
  for (const route of routes) {
    it.each(['admin', 'pm'] as const)(`${route.method} admits active %s cookies with bearer disabled`, async (role) => {
      vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')
      try {
        getActor.mockResolvedValue({ ...actor, role, permission_role: role })
        expect((await route.run(request(route.method, route.body))).status).toBe(route.status)
        expect(verify).not.toHaveBeenCalled()
      } finally { vi.unstubAllEnvs() }
    })

    it(`${route.method} rejects ordinary permission roles regardless of hierarchy/legacy roles`, async () => {
      getActor.mockResolvedValue({ ...actor, role: 'admin', permission_role: 'user', hierarchy_role: 'manager' })
      const response = await route.run(request(route.method, route.body))
      expect(response.status).toBe(403)
      expectNoWrites()
      expect(persistence.listProjects).not.toHaveBeenCalled()
    })

    it(`${route.method} rejects inactive and anonymous cookie actors`, async () => {
      getActor.mockResolvedValueOnce({ ...actor, isActive: false }).mockResolvedValueOnce(null)
      expect((await route.run(request(route.method, route.body))).status).toBe(403)
      expect((await route.run(request(route.method, route.body))).status).toBe(401)
      expectNoWrites()
    })

    it(`${route.method} never falls back from malformed bearer to cookies`, async () => {
      expect((await route.run(request(route.method, route.body, { authorization: 'invalid' }))).status).toBe(401)
      expect(getActor).not.toHaveBeenCalled()
      expectNoWrites()
    })

    if (route.method === 'GET') continue
    it(`${route.method} rejects foreign origins before resolving identity`, async () => {
      expect((await route.run(request(route.method, route.body, { origin: 'https://evil.example' }))).status).toBe(403)
      expect(getActor).not.toHaveBeenCalled()
      expectNoWrites()
    })

    it.each(['closed', 'unreadable'])(`${route.method} refuses a %s write fence`, async (state) => {
      if (state === 'closed') gate.mockResolvedValue({ status: 503, body: { error: 'Writers are fenced.' } })
      else gate.mockRejectedValue(new Error('Gate unavailable'))
      const response = await route.run(request(route.method, route.body))
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('60')
      expectNoWrites()
    })
  }
})

describe('browser project write parity', () => {
  it('creates by name only and acknowledges without a read-back', async () => {
    const response = await POST(request('POST', { name: ' Alpha ' }))
    expect(await response.json()).toEqual({ data: { success: true }, error: null })
    expect(persistence.createProject).toHaveBeenCalledWith(actor, 'Alpha')
    expect(persistence.listProjects).not.toHaveBeenCalled()
  })

  it('normalizes each field and clears S.O./Telegram without post-write queries', async () => {
    persistence.listProjects.mockRejectedValue(new Error('Refresh unavailable'))
    expect((await PATCH(request('PATCH', { name: ' Beta ' }), context)).status).toBe(200)
    expect(persistence.renameProject).toHaveBeenCalledWith(actor, 'p1', 'Beta')
    expect((await PATCH(request('PATCH', { soNumber: ' SO-1 ' }), context)).status).toBe(200)
    expect(persistence.setProjectSO).toHaveBeenCalledWith(actor, 'p1', 'SO-1')
    expect((await PATCH(request('PATCH', { soNumber: '' }), context)).status).toBe(200)
    expect(persistence.setProjectSO).toHaveBeenLastCalledWith(actor, 'p1', null)
    expect((await PATCH(request('PATCH', { telegramNo: 7 }), context)).status).toBe(200)
    expect(persistence.setProjectTelegramNo).toHaveBeenCalledWith(actor, 'p1', 7)
    expect((await PATCH(request('PATCH', { telegramNo: null }), context)).status).toBe(200)
    expect(persistence.setProjectTelegramNo).toHaveBeenLastCalledWith(actor, 'p1', null)
    expect(persistence.listProjects).not.toHaveBeenCalled()
  })

  it('preserves blank-name and nonpositive/fractional Telegram validation', async () => {
    expect((await POST(request('POST', { name: ' ' }))).status).toBe(400)
    expect((await PATCH(request('PATCH', { name: ' ' }), context)).status).toBe(400)
    for (const telegramNo of [0, -1, 1.5]) {
      expect((await PATCH(request('PATCH', { telegramNo }), context)).status).toBe(400)
    }
    expectNoWrites()
  })

  it('does not treat malformed field types as requests to clear data', async () => {
    for (const body of [null, [], {}, { soNumber: 7 }, { telegramNo: '7' }]) {
      expect((await PATCH(request('PATCH', body), context)).status).toBe(400)
    }
    expectNoWrites()
  })

  it('preserves duplicate-name and dependent-entry errors', async () => {
    persistence.createProject.mockResolvedValue({ data: null, error: 'Project already exists.' })
    const created = await POST(request('POST', { name: 'Alpha' }))
    expect(created.status).toBe(409)
    expect(await created.json()).toMatchObject({ error: { message: 'Project already exists.' } })
    persistence.deleteProject.mockResolvedValue({ error: 'Cannot delete: referenced.' })
    const deleted = await DELETE(request('DELETE'), context)
    expect(deleted.status).toBe(409)
    expect(await deleted.json()).toMatchObject({ error: { message: 'Cannot delete: referenced.' } })
  })

  it('keeps mobile bearer PATCH returning its read-back DTO', async () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    verify.mockResolvedValue({ userId: actor.id, sessionId: 's1', familyId: 'f1' })
    findSession.mockResolvedValue({
      actor,
      session: { id: 's1', userId: actor.id, familyId: 'f1', revokedAt: null, rotatedAt: null, idleExpiresAt: future, absoluteExpiresAt: future },
    })
    persistence.listProjects.mockResolvedValue([{ ...project, name: 'Beta' }])
    const response = await PATCH(request('PATCH', { name: 'Beta' }, { authorization: 'Bearer access' }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ...project, name: 'Beta' }, error: null })
    expect(getActor).not.toHaveBeenCalled()
    expect(persistence.listProjects).toHaveBeenCalledTimes(1)
  })
})
