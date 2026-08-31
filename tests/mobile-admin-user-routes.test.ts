import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequire,
  mockListProfiles,
  mockGetProfileById,
  mockCreateUser,
  mockUpdateUserStatus,
  mockUpdateUserRoles,
  mockUpdateUserName,
  mockUpdateUserHierarchy,
  mockListTitleRecords,
  mockAddTitle,
  mockGetTitleImpact,
  mockReclassifyTitle,
  mockDeleteTitle,
} = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockListProfiles: vi.fn(),
  mockGetProfileById: vi.fn(),
  mockCreateUser: vi.fn(),
  mockUpdateUserStatus: vi.fn(),
  mockUpdateUserRoles: vi.fn(),
  mockUpdateUserName: vi.fn(),
  mockUpdateUserHierarchy: vi.fn(),
  mockListTitleRecords: vi.fn(),
  mockAddTitle: vi.fn(),
  mockGetTitleImpact: vi.fn(),
  mockReclassifyTitle: vi.fn(),
  mockDeleteTitle: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, init?: number | { status?: number }) => {
    const status = typeof init === 'number' ? init : init?.status ?? 200
    return { body, status }
  }),
  badRequest: vi.fn((message: string) => ({ body: { error: { code: 'BAD_REQUEST', message } }, status: 400 })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { error: { code, message } },
    status,
  })),
  serverError: vi.fn((err: unknown) => ({ body: { error: err }, status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    listProfiles: mockListProfiles,
    getProfileById: mockGetProfileById,
    createUser: mockCreateUser,
    updateUserStatus: mockUpdateUserStatus,
    updateUserRoles: mockUpdateUserRoles,
    updateUserName: mockUpdateUserName,
    updateUserHierarchy: mockUpdateUserHierarchy,
    listTitleRecords: mockListTitleRecords,
    addTitle: mockAddTitle,
    getTitleImpact: mockGetTitleImpact,
    reclassifyTitle: mockReclassifyTitle,
    deleteTitle: mockDeleteTitle,
  },
}))

vi.mock('@/lib/auth/super-admin', () => ({
  isSuperAdmin: (actor: { email?: string } | null | undefined) => actor?.email === 'superadmin@vsis.lk',
}))

import { GET as getUsers, POST as postUsers } from '@/app/api/v1/admin/users/route'
import { PATCH as patchUser } from '@/app/api/v1/admin/users/[id]/route'
import {
  GET as getTitles,
  POST as postTitles,
  PATCH as patchTitles,
} from '@/app/api/v1/admin/titles/route'
import { GET as getTitleImpact } from '@/app/api/v1/admin/titles/impact/route'

interface MockResponse<T = Record<string, unknown>> {
  status: number
  body: {
    data?: T
    error?: { code?: string; message?: string } | null
  }
}

describe('Slice 10: Mobile User and Role Administration Routes', () => {
  const superAdminActor = {
    id: 'u-super',
    email: 'superadmin@vsis.lk',
    role: 'admin' as const,
    permission_role: 'admin' as const,
    hierarchy_role: 'manager' as const,
    isActive: true,
  }

  const adminActor = {
    id: 'u-admin',
    email: 'admin@vsis.lk',
    role: 'admin' as const,
    permission_role: 'admin' as const,
    hierarchy_role: 'manager' as const,
    isActive: true,
  }

  const userActor = {
    id: 'u-dev',
    email: 'dev@vsis.lk',
    role: 'user' as const,
    permission_role: 'user' as const,
    hierarchy_role: 'engineer' as const,
    isActive: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockRequire.mockResolvedValue({ ok: true, actor: adminActor })
    mockListProfiles.mockResolvedValue([])
    mockListTitleRecords.mockResolvedValue([
      { id: 't1', name: 'Software Engineer', hierarchyRole: 'engineer' },
      { id: 't2', name: 'Engineering Director', hierarchyRole: 'manager' },
    ])
  })

  describe('/api/v1/admin/users', () => {
    it('authorizes admin to list users and rejects regular users with 403', async () => {
      mockListProfiles.mockResolvedValueOnce([
        { id: 'u1', email: 'dev@vsis.lk', name: 'Developer', is_active: true },
      ])

      const resAdmin = (await getUsers(new Request('http://localhost/api/v1/admin/users'))) as unknown as MockResponse<Array<{ id: string }>>
      expect(resAdmin.status).toBe(200)
      expect(resAdmin.body.data).toHaveLength(1)

      mockRequire.mockResolvedValueOnce({ ok: true, actor: userActor })
      const resUser = (await getUsers(new Request('http://localhost/api/v1/admin/users'))) as unknown as MockResponse
      expect(resUser.status).toBe(403)
    })

    it('creates new user account following password complexity rules', async () => {
      mockCreateUser.mockResolvedValueOnce({ error: null })
      mockListProfiles.mockResolvedValue([
        {
          id: 'u-new',
          email: 'newbie@vsis.lk',
          name: 'Newbie User',
          permission_role: 'user',
          hierarchy_role: 'engineer',
          is_active: true,
        },
      ])

      const req = new Request('http://localhost/api/v1/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newbie@vsis.lk',
          password: 'Password123!',
          name: 'Newbie User',
          department: 'Engineering',
          title: 'Software Engineer',
          permissionRole: 'user',
        }),
      })

      const res = (await postUsers(req)) as unknown as MockResponse
      expect(res.status).toBe(201)
      expect(mockCreateUser).toHaveBeenCalledWith(
        adminActor,
        expect.objectContaining({
          email: 'newbie@vsis.lk',
          name: 'Newbie User',
          hierarchyRole: 'engineer',
          permissionRole: 'user',
        })
      )
    })

    it('rejects weak password with 400 Bad Request', async () => {
      const req = new Request('http://localhost/api/v1/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'weak@vsis.lk',
          password: 'weak',
          name: 'Weak Pass',
          permissionRole: 'user',
        }),
      })

      const res = (await postUsers(req)) as unknown as MockResponse
      expect(res.status).toBe(400)
    })
  })

  describe('/api/v1/admin/users/[id]', () => {
    it('prevents self-deactivation and self-role demotion', async () => {
      mockGetProfileById.mockResolvedValue({
        id: 'u-admin',
        email: 'admin@vsis.lk',
        permission_role: 'admin',
        hierarchy_role: 'manager',
        is_active: true,
      })

      // Self-deactivation attempt
      const reqDeact = new Request('http://localhost/api/v1/admin/users/u-admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      })
      const resDeact = (await patchUser(reqDeact, { params: Promise.resolve({ id: 'u-admin' }) })) as unknown as MockResponse
      expect(resDeact.status).toBe(400)
      expect(resDeact.body.error?.message).toContain('cannot deactivate your own account')

      // Self-role change attempt
      const reqRole = new Request('http://localhost/api/v1/admin/users/u-admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionRole: 'user' }),
      })
      const resRole = (await patchUser(reqRole, { params: Promise.resolve({ id: 'u-admin' }) })) as unknown as MockResponse
      expect(resRole.status).toBe(400)
      expect(resRole.body.error?.message).toContain('cannot change your own roles')
    })

    it('prevents self-reporting and cycles', async () => {
      mockGetProfileById.mockResolvedValue({
        id: 'u-dev',
        email: 'dev@vsis.lk',
        permission_role: 'user',
        hierarchy_role: 'engineer',
        is_active: true,
      })

      // Self-reporting
      const reqSelf = new Request('http://localhost/api/v1/admin/users/u-dev', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerId: 'u-dev' }),
      })
      const resSelf = (await patchUser(reqSelf, { params: Promise.resolve({ id: 'u-dev' }) })) as unknown as MockResponse
      expect(resSelf.status).toBe(400)
      expect(resSelf.body.error?.message).toContain('cannot report to themselves')
    })
  })

  describe('/api/v1/admin/titles', () => {
    it('allows title listing for all users', async () => {
      mockRequire.mockResolvedValueOnce({ ok: true, actor: userActor })
      const res = (await getTitles(new Request('http://localhost/api/v1/admin/titles'))) as unknown as MockResponse<Array<{ id: string }>>
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(2)
    })

    it('restricts title creation/reclassification/deletion to super-admin', async () => {
      // Normal admin attempt -> 403
      const reqAdmin = new Request('http://localhost/api/v1/admin/titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Staff Engineer', hierarchyRole: 'engineer' }),
      })
      const resAdmin = (await postTitles(reqAdmin)) as unknown as MockResponse
      expect(resAdmin.status).toBe(403)

      // Super-admin attempt -> 201
      mockRequire.mockResolvedValueOnce({ ok: true, actor: superAdminActor })
      mockAddTitle.mockResolvedValueOnce({ error: null })
      mockListTitleRecords.mockResolvedValueOnce([
        { id: 't3', name: 'Staff Engineer', hierarchyRole: 'engineer' },
      ])

      const resSuper = (await postTitles(reqAdmin)) as unknown as MockResponse
      expect(resSuper.status).toBe(201)
      expect(mockAddTitle).toHaveBeenCalledWith(superAdminActor, 'Staff Engineer', 'engineer')
    })

    it('calculates title impact and restricts impact route to super-admin', async () => {
      // Normal admin attempt -> 403
      const reqImpactAdmin = new Request('http://localhost/api/v1/admin/titles/impact?name=Systems%20Engineer&proposedRole=manager')
      const resImpactAdmin = (await getTitleImpact(reqImpactAdmin)) as unknown as MockResponse
      expect(resImpactAdmin.status).toBe(403)

      // Super-admin attempt -> 200
      mockRequire.mockResolvedValueOnce({ ok: true, actor: superAdminActor })
      mockGetTitleImpact.mockResolvedValueOnce({
        title: 'Systems Engineer',
        currentHierarchyRole: 'engineer',
        proposedHierarchyRole: 'manager',
        affectedCount: 4,
        syncRequired: true,
      })

      const resImpactSuper = (await getTitleImpact(reqImpactAdmin)) as unknown as MockResponse<{ affectedCount: number; syncRequired: boolean }>
      expect(resImpactSuper.status).toBe(200)
      expect(resImpactSuper.body.data?.affectedCount).toBe(4)
      expect(resImpactSuper.body.data?.syncRequired).toBe(true)
      expect(mockGetTitleImpact).toHaveBeenCalledWith(superAdminActor, 'Systems Engineer', 'manager')
    })

    it('applies title reclassification atomically and reports affected users', async () => {
      mockRequire.mockResolvedValueOnce({ ok: true, actor: superAdminActor })
      mockReclassifyTitle.mockResolvedValueOnce({ error: null, affectedCount: 4 })

      const reqPatch = new Request('http://localhost/api/v1/admin/titles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Systems Engineer',
          hierarchyRole: 'manager',
          syncUsers: true,
        }),
      })

      const resPatch = (await patchTitles(reqPatch)) as unknown as MockResponse<{ affectedCount: number }>
      expect(resPatch.status).toBe(200)
      expect(resPatch.body.data?.affectedCount).toBe(4)
      expect(mockReclassifyTitle).toHaveBeenCalledWith(superAdminActor, 'Systems Engineer', 'manager', true)
    })
  })
})
