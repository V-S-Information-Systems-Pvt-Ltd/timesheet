import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/app/types'
import { browserUserMutationSchema } from '@vsis/contracts'
import { PERMISSION_ROLES, HIERARCHY_ROLES } from '@/lib/roles'

const { getActor, gate, verify, findSession, createAccount, persistence } = vi.hoisted(() => ({
  getActor: vi.fn(), gate: vi.fn(), verify: vi.fn(), findSession: vi.fn(), createAccount: vi.fn(),
  persistence: {
    listProfiles: vi.fn(), getProfileById: vi.fn(), listTitleRecords: vi.fn(), writeAuditLog: vi.fn(),
    updateUserStatus: vi.fn(), updateUserRoles: vi.fn(), updateUserName: vi.fn(),
    updateUserManager: vi.fn(), updateUserHierarchy: vi.fn(), updateUser: vi.fn(),
  },
}))
vi.mock('@/lib/auth', async () => ({ ...await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth'), getActor }))
vi.mock('@/lib/db/write-gate', () => ({ writeGateResponse: gate }))
vi.mock('@/lib/db/people', () => ({ peopleDeps: () => ({ persistence, identity: { createAccount } }) }))
vi.mock('@/lib/auth/mobile-tokens', () => ({ verifyMobileAccessToken: verify, isLegacyMobileToken: vi.fn(async () => false) }))
vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { findSessionAndActorById: findSession } }))

import { GET, POST } from '@/app/api/v1/admin/users/route'
import { PATCH } from '@/app/api/v1/admin/users/[id]/route'
import { createBrowserUserService, mutateBrowserUserService } from '@/lib/api/v1/services/browser-users'

const actor = {
  id: 'admin-1', email: 'admin@example.com', isActive: true,
  role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'manager' as const,
}
function profile(id: string, overrides: Partial<User> = {}): User {
  return {
    id, email: `${id}@example.com`, name: id, department: '', title: '', role: 'user',
    permission_role: 'user', hierarchy_role: 'user', is_active: true, manager_id: null,
    dashboard_layout: null, admin_layout: null, mobile_layout: null, created_at: '', ...overrides,
  }
}
const target = profile('target')
const createInput = {
  email: ' New@Example.com ', password: 'Test-password-123', name: ' New User ', department: ' Team ', title: '',
  permissionRole: 'pm' as const, hierarchyRole: 'engineer' as const, isActive: false, managerId: null,
}
function request(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000/api/v1/admin/users${method === 'PATCH' ? '/target' : ''}`, {
    method, headers: { host: 'localhost:3000', origin: 'http://localhost:3000', cookie: 'session=1', 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function patch(body: unknown, id = 'target', headers?: Record<string, string>) {
  return PATCH(request('PATCH', body, headers), { params: Promise.resolve({ id }) })
}
function noWrites() {
  expect(createAccount).not.toHaveBeenCalled()
  for (const write of [persistence.updateUserStatus, persistence.updateUserRoles, persistence.updateUserName,
    persistence.updateUserManager, persistence.updateUserHierarchy, persistence.updateUser]) expect(write).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks()
  getActor.mockResolvedValue(actor)
  gate.mockResolvedValue(null)
  persistence.getProfileById.mockResolvedValue(target)
  persistence.listProfiles.mockResolvedValue([target])
  persistence.listTitleRecords.mockResolvedValue([
    { id: 't1', name: 'Manager', hierarchy_role: 'manager', created_at: '' },
    { id: 't2', name: 'Systems Engineer', hierarchy_role: 'engineer', created_at: '' },
  ])
  persistence.writeAuditLog.mockResolvedValue(undefined)
  createAccount.mockResolvedValue({ id: 'new', error: null })
  for (const write of [persistence.updateUserStatus, persistence.updateUserRoles, persistence.updateUserName,
    persistence.updateUserManager, persistence.updateUserHierarchy, persistence.updateUser]) write.mockResolvedValue({ error: null })
})

describe('browser user administration guards', () => {
  const routes = [
    { method: 'GET', run: () => GET(request('GET')), status: 200 },
    { method: 'POST', run: () => POST(request('POST', createInput)), status: 201 },
    { method: 'PATCH', run: () => patch({ operation: 'name', name: 'Updated' }), status: 200 },
  ]
  for (const route of routes) {
    it(`${route.method} admits active admin cookies independently of the bearer flag`, async () => {
      vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')
      try {
        expect((await route.run()).status).toBe(route.status)
        expect(verify).not.toHaveBeenCalled()
      } finally { vi.unstubAllEnvs() }
    })
    it.each(['pm', 'co', 'user'] as const)(`${route.method} denies %s permission despite leadership/legacy admin roles`, async (role) => {
      getActor.mockResolvedValue({ ...actor, permission_role: role })
      expect((await route.run()).status).toBe(403)
      noWrites()
    })
    it(`${route.method} denies inactive and anonymous actors`, async () => {
      getActor.mockResolvedValueOnce({ ...actor, isActive: false }).mockResolvedValueOnce(null)
      expect((await route.run()).status).toBe(403)
      expect((await route.run()).status).toBe(401)
      noWrites()
    })
  }

  it.each(['POST', 'PATCH'])('%s rejects origin before identity and never falls back from invalid bearer', async (method) => {
    const body = method === 'POST' ? createInput : { operation: 'name', name: 'Next' }
    const run = (headers: Record<string, string>) => method === 'POST' ? POST(request(method, body, headers)) : patch(body, 'target', headers)
    expect((await run({ origin: 'https://evil.example' })).status).toBe(403)
    expect((await run({ authorization: 'invalid' })).status).toBe(401)
    expect(getActor).not.toHaveBeenCalled()
    noWrites()
  })

  it.each(['POST', 'PATCH'])('%s fails closed for closed and unreadable fences', async (method) => {
    const run = () => method === 'POST' ? POST(request(method, createInput)) : patch({ operation: 'name', name: 'Next' })
    gate.mockResolvedValueOnce({ status: 503, body: { error: 'Writers fenced.' } }).mockRejectedValueOnce(new Error('Gate unavailable'))
    for (let i = 0; i < 2; i++) {
      const response = await run()
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('60')
    }
    noWrites()
  })

  it('browser services also reject inactive admins when called directly', async () => {
    const inactive = { ...actor, isActive: false }
    expect(await createBrowserUserService(inactive, createInput)).toMatchObject({ success: false, status: 403 })
    expect(await mutateBrowserUserService(inactive, 'target', { operation: 'toggle-status' })).toMatchObject({ success: false, status: 403 })
    noWrites()
  })
})

describe('browser narrow user-operation parity', () => {
  it('creates through identity with independent role axes, normalized fields and no read-back', async () => {
    const response = await POST(request('POST', createInput))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ data: { success: true }, error: null })
    expect(createAccount).toHaveBeenCalledWith(actor, { ...createInput, email: 'new@example.com', name: 'New User', department: 'Team' })
    expect(persistence.listProfiles).not.toHaveBeenCalled()
    expect(persistence.getProfileById).not.toHaveBeenCalled()
    expect(persistence.writeAuditLog).toHaveBeenCalledWith(actor, expect.objectContaining({ action: 'user.create' }))
  })

  it('preserves credential wording, password/title validation and identity conflicts', async () => {
    const missing = await POST(request('POST', { ...createInput, email: '', password: '' }))
    expect(await missing.json()).toMatchObject({ error: { message: 'Email and a password are required.' } })
    expect((await POST(request('POST', { ...createInput, password: 'weak' }))).status).toBe(400)
    expect((await POST(request('POST', { ...createInput, title: 'Manager', hierarchyRole: 'user' }))).status).toBe(400)
    expect(createAccount).not.toHaveBeenCalled()
    createAccount.mockResolvedValue({ error: 'Account already exists.' })
    const conflict = await POST(request('POST', createInput))
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: { message: 'Account already exists.' } })
  })

  it('toggles the current server status rather than a stale UI value', async () => {
    persistence.getProfileById.mockResolvedValueOnce({ ...target, is_active: false }).mockResolvedValueOnce(target)
    expect((await patch({ operation: 'toggle-status' })).status).toBe(200)
    expect(persistence.updateUserStatus).toHaveBeenLastCalledWith(actor, 'target', true)
    expect((await patch({ operation: 'toggle-status' })).status).toBe(200)
    expect(persistence.updateUserStatus).toHaveBeenLastCalledWith(actor, 'target', false)
    expect(persistence.writeAuditLog).toHaveBeenCalledTimes(2)
  })

  it('keeps unconditional self-role/reporting-line and self-deactivation guards', async () => {
    persistence.getProfileById.mockResolvedValue(profile(actor.id, { permission_role: 'admin', hierarchy_role: 'manager' }))
    const roles = await patch({ operation: 'roles', permissionRole: 'admin', hierarchyRole: 'manager' }, actor.id)
    expect(await roles.json()).toMatchObject({ error: { message: 'You cannot change your own roles.' } })
    const manager = await patch({ operation: 'manager', managerId: null }, actor.id)
    expect(await manager.json()).toMatchObject({ error: { message: 'You cannot change your own reporting line.' } })
    const status = await patch({ operation: 'toggle-status' }, actor.id)
    expect(await status.json()).toMatchObject({ error: { message: 'You cannot deactivate your own account.' } })
    noWrites()
  })

  it('uses the dedicated role and name writes without generic updater/read-back', async () => {
    expect((await patch({ operation: 'roles', permissionRole: 'pm', hierarchyRole: 'engineer' })).status).toBe(200)
    expect(persistence.updateUserRoles).toHaveBeenCalledWith(actor, 'target', 'pm', 'engineer')
    expect((await patch({ operation: 'name', name: ' Next ' })).status).toBe(200)
    expect(persistence.updateUserName).toHaveBeenCalledWith(actor, 'target', 'Next')
    expect(persistence.getProfileById).not.toHaveBeenCalled()
    expect(persistence.updateUser).not.toHaveBeenCalled()
  })

  it('clears department and manager while preserving dedicated audit events', async () => {
    expect((await patch({ operation: 'department', department: ' ' })).status).toBe(200)
    expect(persistence.updateUser).toHaveBeenCalledWith(actor, 'target', { department: null })
    expect((await patch({ operation: 'manager', managerId: null })).status).toBe(200)
    expect(persistence.updateUserManager).toHaveBeenCalledWith(actor, 'target', null)
    expect(persistence.writeAuditLog).toHaveBeenCalledWith(actor, expect.objectContaining({ action: 'user.department_change' }))
    expect(persistence.writeAuditLog).toHaveBeenCalledWith(actor, expect.objectContaining({ action: 'user.manager_change' }))
    expect(persistence.getProfileById).not.toHaveBeenCalled()
  })

  it('derives hierarchy from title without changing permission and rejects contradictions', async () => {
    expect((await patch({ operation: 'hierarchy', managerId: null, title: 'Manager' })).status).toBe(200)
    expect(persistence.updateUserHierarchy).toHaveBeenCalledWith(actor, 'target', { managerId: null, title: 'Manager', hierarchyRole: 'manager' })
    const response = await patch({ operation: 'hierarchy', managerId: null, title: 'Manager', hierarchyRole: 'user' })
    expect(response.status).toBe(400)
    expect(persistence.updateUserHierarchy).toHaveBeenCalledTimes(1)
    expect(persistence.updateUserRoles).not.toHaveBeenCalled()
  })

  it('preserves manager and hierarchy cycle checks', async () => {
    persistence.listProfiles.mockResolvedValue([target, profile('leader', { manager_id: 'target' })])
    const manager = await patch({ operation: 'manager', managerId: 'leader' })
    expect(manager.status).toBe(400)
    expect(await manager.json()).toMatchObject({ error: { message: 'That assignment would create a reporting cycle.' } })
    expect((await patch({ operation: 'hierarchy', managerId: 'leader' })).status).toBe(400)
    noWrites()
  })

  it('rejects missing targets and malformed/disguised broad patches without writes', async () => {
    persistence.getProfileById.mockResolvedValue(null)
    expect((await patch({ operation: 'toggle-status' })).status).toBe(404)
    expect((await patch({ operation: 'hierarchy', managerId: null })).status).toBe(404)
    for (const body of [null, [], {}, { isActive: false }, { operation: 'toggle-status', isActive: false },
      { operation: 'manager', managerId: 7 }, { operation: 'roles', permissionRole: 'owner', hierarchyRole: 'user' }]) {
      expect((await patch(body)).status).toBe(400)
    }
    noWrites()
  })

  it('retains write errors but does not turn best-effort audit errors into failed writes', async () => {
    persistence.updateUserName.mockResolvedValueOnce({ error: 'Write refused.' })
    const failed = await patch({ operation: 'name', name: 'Next' })
    expect(failed.status).toBe(400)
    expect(await failed.json()).toMatchObject({ error: { message: 'Write refused.' } })
    persistence.writeAuditLog.mockRejectedValue(new Error('Audit unavailable'))
    expect((await patch({ operation: 'roles', permissionRole: 'pm', hierarchyRole: 'engineer' })).status).toBe(200)
  })

  it('keeps canonical role schema values aligned with the application roles', () => {
    for (const permissionRole of PERMISSION_ROLES) for (const hierarchyRole of HIERARCHY_ROLES) {
      expect(browserUserMutationSchema.safeParse({ operation: 'roles', permissionRole, hierarchyRole }).success).toBe(true)
    }
  })

  it('keeps bearer PATCH on the atomic generic updater and returns its DTO', async () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    verify.mockResolvedValue({ userId: actor.id, sessionId: 's1', familyId: 'f1' })
    findSession.mockResolvedValue({ actor, session: {
      id: 's1', userId: actor.id, familyId: 'f1', revokedAt: null, rotatedAt: null,
      idleExpiresAt: future, absoluteExpiresAt: future,
    } })
    persistence.getProfileById.mockResolvedValueOnce(target).mockResolvedValueOnce({ ...target, name: 'Next' })
    const response = await patch({ name: 'Next' }, 'target', { authorization: 'Bearer access' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ...target, name: 'Next' }, error: null })
    expect(persistence.updateUser).toHaveBeenCalledWith(actor, 'target', expect.objectContaining({ name: 'Next' }))
    expect(persistence.updateUserName).not.toHaveBeenCalled()
    expect(getActor).not.toHaveBeenCalled()
  })
})
