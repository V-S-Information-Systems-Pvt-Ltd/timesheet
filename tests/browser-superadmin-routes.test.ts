import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getActor, gate, verify, findSession, safeAudit, reference, operations, people, identity } = vi.hoisted(() => ({
  getActor: vi.fn(), gate: vi.fn(), verify: vi.fn(), findSession: vi.fn(), safeAudit: vi.fn(),
  reference: {
    deleteActivityType: vi.fn(), listWhitelistedDomains: vi.fn(), addWhitelistedDomain: vi.fn(),
    updateWhitelistedDomain: vi.fn(), deleteWhitelistedDomain: vi.fn(), addTitle: vi.fn(),
    reclassifyTitle: vi.fn(), deleteTitle: vi.fn(), getTitleImpact: vi.fn(), listTitleRecords: vi.fn(),
  },
  operations: {
    resetTimesheets: vi.fn(), resetActivityData: vi.fn(), resetAllData: vi.fn(), writeAuditLog: vi.fn(),
  },
  people: { writeAuditLog: vi.fn() },
  identity: { deleteAccount: vi.fn() },
}))

vi.mock('@/lib/auth', async () => ({ ...await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth'), getActor }))
vi.mock('@/lib/db/write-gate', () => ({ writeGateResponse: gate }))
vi.mock('@/lib/auth/mobile-tokens', () => ({ verifyMobileAccessToken: verify, isLegacyMobileToken: vi.fn(async () => false) }))
vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { findSessionAndActorById: findSession } }))
vi.mock('@/lib/audit', () => ({ safeAudit }))
vi.mock('@/lib/db/reference', () => ({ referenceDeps: () => ({ persistence: reference }) }))
vi.mock('@/lib/db/operations', () => ({
  operationsDeps: () => ({ persistence: operations, maintenance: {}, clock: () => new Date(), backend: 'native' }),
}))
vi.mock('@/lib/db/people', () => ({ peopleDeps: () => ({ persistence: people, identity }) }))

import { POST as resetDatabase } from '@/app/api/v1/admin/superadmin/reset/route'
import { DELETE as deleteUser } from '@/app/api/v1/admin/superadmin/users/[id]/route'
import { GET as getWhitelist, POST as addWhitelist } from '@/app/api/v1/admin/superadmin/whitelist/route'
import { PATCH as updateWhitelist, DELETE as deleteWhitelist } from '@/app/api/v1/admin/superadmin/whitelist/[id]/route'
import { DELETE as deleteActivityType } from '@/app/api/v1/admin/activity-types/[id]/route'
import { POST as addTitle, PATCH as reclassifyTitle, DELETE as deleteTitle } from '@/app/api/v1/admin/titles/route'
import { GET as getTitleImpact } from '@/app/api/v1/admin/titles/impact/route'

const superAdmin = {
  id: 'super-1', email: 'super@example.com', isActive: true,
  role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'manager' as const,
}
const admin = { ...superAdmin, id: 'admin-1', email: 'admin@example.com' }
const domain = { id: 'd1', domain: 'example.com', auto_activate: false, created_at: '2026-09-26' }
const titleImpact = {
  title: 'Engineer', currentHierarchyRole: 'engineer' as const,
  proposedHierarchyRole: 'team_lead' as const, affectedCount: 2, syncRequired: true,
}

function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      host: 'localhost:3000', origin: 'http://localhost:3000', cookie: 'session=1',
      'content-type': 'application/json', ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.SUPER_ADMIN_EMAIL = superAdmin.email
  getActor.mockResolvedValue(superAdmin)
  gate.mockResolvedValue(null)
  reference.listWhitelistedDomains.mockResolvedValue([domain])
  reference.addWhitelistedDomain.mockResolvedValue({ error: null })
  reference.updateWhitelistedDomain.mockResolvedValue({ error: null })
  reference.deleteWhitelistedDomain.mockResolvedValue({ error: null })
  reference.deleteActivityType.mockResolvedValue({ error: null })
  reference.addTitle.mockResolvedValue({ data: { name: 'Architect', hierarchy_role: 'user' }, error: null })
  reference.reclassifyTitle.mockResolvedValue({ error: null, affectedCount: 2 })
  reference.deleteTitle.mockResolvedValue({ error: null })
  reference.getTitleImpact.mockResolvedValue(titleImpact)
  reference.listTitleRecords.mockResolvedValue([])
  operations.resetTimesheets.mockResolvedValue({ error: null })
  operations.resetActivityData.mockResolvedValue({ error: null })
  operations.resetAllData.mockResolvedValue({ error: null })
  operations.writeAuditLog.mockResolvedValue({ error: null })
  identity.deleteAccount.mockResolvedValue({ error: null })
  people.writeAuditLog.mockResolvedValue({ error: null })
})

afterEach(() => { delete process.env.SUPER_ADMIN_EMAIL })

describe('browser superadmin lifecycle routes', () => {
  it('keeps whitelist reads available while writes are fenced', async () => {
    gate.mockResolvedValue({ status: 503, body: { error: 'Writers fenced.' } })
    const response = await getWhitelist(request('/api/v1/admin/superadmin/whitelist'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [domain], error: null })
    expect(gate).not.toHaveBeenCalled()
  })

  it('creates, toggles and deletes whitelist entries with the legacy audit events', async () => {
    expect((await addWhitelist(request('/api/v1/admin/superadmin/whitelist', 'POST', {
      domain: '@Example.com', autoActivate: true,
    }))).status).toBe(201)
    expect(reference.addWhitelistedDomain).toHaveBeenCalledWith(superAdmin, 'example.com', true)

    const context = { params: Promise.resolve({ id: 'd1' }) }
    expect((await updateWhitelist(request('/api/v1/admin/superadmin/whitelist/d1', 'PATCH', {
      autoActivate: true,
    }), context)).status).toBe(200)
    expect((await deleteWhitelist(request('/api/v1/admin/superadmin/whitelist/d1', 'DELETE'), context)).status).toBe(200)
    expect(safeAudit).toHaveBeenCalledWith(superAdmin, expect.objectContaining({ action: 'domain.whitelist_add' }))
    expect(safeAudit).toHaveBeenCalledWith(superAdmin, expect.objectContaining({ action: 'domain.whitelist_toggle', targetId: 'd1' }))
    expect(safeAudit).toHaveBeenCalledWith(superAdmin, expect.objectContaining({ action: 'domain.whitelist_delete', targetId: 'd1' }))
  })

  it('resets data, permanently deletes a user and restricts activity deletion to superadmin', async () => {
    expect((await resetDatabase(request('/api/v1/admin/superadmin/reset', 'POST', { mode: 'activity' }))).status).toBe(200)
    expect(operations.resetActivityData).toHaveBeenCalledWith(superAdmin)

    expect((await deleteUser(
      request('/api/v1/admin/superadmin/users/user-2', 'DELETE'),
      { params: Promise.resolve({ id: 'user-2' }) }
    )).status).toBe(200)
    expect(identity.deleteAccount).toHaveBeenCalledWith(superAdmin, 'user-2')

    expect((await deleteActivityType(
      request('/api/v1/admin/activity-types/a1', 'DELETE'),
      { params: Promise.resolve({ id: 'a1' }) }
    )).status).toBe(200)
    expect(safeAudit).toHaveBeenCalledWith(superAdmin, { action: 'activity_type.delete', targetId: 'a1' })

    getActor.mockResolvedValue(admin)
    expect((await deleteActivityType(
      request('/api/v1/admin/activity-types/a1', 'DELETE'),
      { params: Promise.resolve({ id: 'a1' }) }
    )).status).toBe(403)
    expect(reference.deleteActivityType).toHaveBeenCalledTimes(1)
  })

  it('creates, reclassifies, inspects and deletes titles with retained audits', async () => {
    expect((await addTitle(request('/api/v1/admin/titles', 'POST', {
      name: ' Architect ', hierarchyRole: 'user',
    }))).status).toBe(201)
    expect((await reclassifyTitle(request('/api/v1/admin/titles', 'PATCH', {
      name: 'Architect', hierarchyRole: 'team_lead', syncUsers: true,
    }))).status).toBe(200)
    const impact = await getTitleImpact(request(
      '/api/v1/admin/titles/impact?name=Engineer&proposedRole=team_lead'
    ))
    expect(impact.status).toBe(200)
    expect(await impact.json()).toEqual({ data: titleImpact, error: null })
    expect((await deleteTitle(request('/api/v1/admin/titles?name=Architect', 'DELETE'))).status).toBe(200)
    expect(safeAudit).toHaveBeenCalledWith(superAdmin, expect.objectContaining({ action: 'title.add' }))
    expect(safeAudit).toHaveBeenCalledWith(superAdmin, expect.objectContaining({ action: 'title.reclassify' }))
    expect(safeAudit).toHaveBeenCalledWith(superAdmin, expect.objectContaining({ action: 'title.delete' }))
  })

  it('rejects ordinary admins, malformed bodies, unsafe origins and closed fences', async () => {
    getActor.mockResolvedValue(admin)
    expect((await resetDatabase(request('/api/v1/admin/superadmin/reset', 'POST', { mode: 'all' }))).status).toBe(403)
    expect((await addWhitelist(request('/api/v1/admin/superadmin/whitelist', 'POST', {
      domain: 'example.com', autoActivate: false,
    }))).status).toBe(403)

    getActor.mockResolvedValue(superAdmin)
    expect((await resetDatabase(request('/api/v1/admin/superadmin/reset', 'POST', { mode: 'everything' }))).status).toBe(400)
    expect((await addTitle(request('/api/v1/admin/titles', 'POST', { name: 'Architect', extra: true }))).status).toBe(400)
    expect((await addWhitelist(request('/api/v1/admin/superadmin/whitelist', 'POST', {
      domain: 'example.com', autoActivate: false,
    }, { origin: 'https://evil.example' }))).status).toBe(403)

    gate.mockResolvedValue({ status: 503, body: { error: 'Writers fenced.' } })
    const fenced = await resetDatabase(request('/api/v1/admin/superadmin/reset', 'POST', { mode: 'all' }))
    expect(fenced.status).toBe(503)
    expect(fenced.headers.get('retry-after')).toBe('60')
  })
})
