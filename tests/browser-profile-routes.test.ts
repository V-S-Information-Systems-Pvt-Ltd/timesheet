import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActor, gate, verify, findSession, persistence } = vi.hoisted(() => ({
  getActor: vi.fn(), gate: vi.fn(), verify: vi.fn(), findSession: vi.fn(),
  persistence: { getProfileById: vi.fn(), listTitleRecords: vi.fn(), updateMyProfile: vi.fn() },
}))
vi.mock('@/lib/auth', async () => ({ ...await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth'), getActor }))
vi.mock('@/lib/db/write-gate', () => ({ writeGateResponse: gate }))
vi.mock('@/lib/db/people', () => ({ peopleDeps: () => ({ persistence, identity: {} }) }))
vi.mock('@/lib/auth/mobile-tokens', () => ({ verifyMobileAccessToken: verify, isLegacyMobileToken: vi.fn(async () => false) }))
vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { findSessionAndActorById: findSession } }))

import { GET, PATCH } from '@/app/api/v1/profile/route'

const actor = {
  id: 'user-1', email: 'user@example.com', isActive: true,
  role: 'user' as const, permission_role: 'user' as const, hierarchy_role: 'engineer' as const,
  department: 'Engineering', title: 'Systems Engineer',
}
const profile = {
  id: actor.id, email: actor.email, name: 'User One', department: actor.department, title: actor.title,
  role: actor.role, permission_role: actor.permission_role, hierarchy_role: actor.hierarchy_role,
  is_active: true, manager_id: null, dashboard_layout: null, admin_layout: null, mobile_layout: null, created_at: '',
}
function request(method: 'GET' | 'PATCH', body?: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/v1/profile', {
    method,
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', cookie: 'session=1', 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  getActor.mockResolvedValue(actor)
  gate.mockResolvedValue(null)
  persistence.getProfileById.mockResolvedValue(profile)
  persistence.listTitleRecords.mockResolvedValue([
    { id: 't1', name: 'Systems Engineer', hierarchy_role: 'engineer', created_at: '' },
    { id: 't2', name: 'Manager', hierarchy_role: 'manager', created_at: '' },
  ])
  persistence.updateMyProfile.mockResolvedValue({ error: null })
})

describe('browser self-profile route', () => {
  it('allows inactive signed-in reads but refuses inactive writes', async () => {
    getActor.mockResolvedValue({ ...actor, isActive: false })
    const read = await GET(request('GET'))
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({ data: profile, error: null })
    const write = await PATCH(request('PATCH', { department: 'Team', title: 'Systems Engineer' }))
    expect(write.status).toBe(403)
    expect(persistence.updateMyProfile).not.toHaveBeenCalled()
  })

  it('updates only the signed-in actor, trims fields and acknowledges without read-back', async () => {
    persistence.getProfileById.mockRejectedValue(new Error('Read-back must not run'))
    const response = await PATCH(request('PATCH', { department: ' Engineering ', title: ' Systems Engineer ' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { success: true }, error: null })
    expect(persistence.updateMyProfile).toHaveBeenCalledWith(actor, {
      department: 'Engineering', title: 'Systems Engineer',
    })
    expect(persistence.getProfileById).not.toHaveBeenCalled()
  })

  it('allows clearing both fields', async () => {
    expect((await PATCH(request('PATCH', { department: ' ', title: ' ' }))).status).toBe(200)
    expect(persistence.updateMyProfile).toHaveBeenCalledWith(actor, { department: '', title: '' })
  })

  it('rejects titles from another hierarchy role before persistence', async () => {
    const response = await PATCH(request('PATCH', { department: 'Engineering', title: 'Manager' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: expect.stringContaining('requires an administrator') },
    })
    expect(persistence.updateMyProfile).not.toHaveBeenCalled()
  })

  it.each([null, [], {}, { department: 'Team' }, { title: 'Systems Engineer' },
    { department: 'Team', title: 'Systems Engineer', name: 'Injected' },
    { department: 7, title: 'Systems Engineer' }])('rejects malformed strict input %#', async (body) => {
    expect((await PATCH(request('PATCH', body))).status).toBe(400)
    expect(persistence.updateMyProfile).not.toHaveBeenCalled()
  })

  it('surfaces provider write errors', async () => {
    persistence.updateMyProfile.mockResolvedValue({ error: 'Profile write refused.' })
    const response = await PATCH(request('PATCH', { department: 'Team', title: 'Systems Engineer' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'BAD_REQUEST', message: 'Profile write refused.' } })
  })

  it('rejects anonymous and foreign-origin writes before persistence', async () => {
    getActor.mockResolvedValueOnce(null)
    expect((await PATCH(request('PATCH', { department: '', title: '' }))).status).toBe(401)
    getActor.mockClear()
    expect((await PATCH(request('PATCH', { department: '', title: '' }, { origin: 'https://evil.example' }))).status).toBe(403)
    expect(getActor).not.toHaveBeenCalled()
    expect(persistence.updateMyProfile).not.toHaveBeenCalled()
  })

  it('never falls back from malformed bearer credentials to cookies', async () => {
    const response = await PATCH(request('PATCH', { department: '', title: '' }, { authorization: 'invalid' }))
    expect(response.status).toBe(401)
    expect(getActor).not.toHaveBeenCalled()
    expect(persistence.updateMyProfile).not.toHaveBeenCalled()
  })

  it.each(['closed', 'unreadable'])('fails closed when the write fence is %s', async (state) => {
    if (state === 'closed') gate.mockResolvedValue({ status: 503, body: { error: 'Writers fenced.' } })
    else gate.mockRejectedValue(new Error('Gate unavailable'))
    const response = await PATCH(request('PATCH', { department: '', title: '' }))
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(persistence.updateMyProfile).not.toHaveBeenCalled()
  })

  it('accepts browser cookies independently of the bearer feature switch', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')
    try {
      expect((await PATCH(request('PATCH', { department: '', title: '' }))).status).toBe(200)
      expect(verify).not.toHaveBeenCalled()
    } finally { vi.unstubAllEnvs() }
  })
})
