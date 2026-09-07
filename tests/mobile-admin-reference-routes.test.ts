import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequire,
  mockListProjects,
  mockCreateProject,
  mockRenameProject,
  mockSetProjectSO,
  mockSetProjectTelegramNo,
  mockDeleteProject,
  mockListActivityTypes,
  mockCreateActivityType,
  mockRenameActivityType,
  mockSetActivityTypeActive,
  mockSetActivityTypeTelegramNo,
  mockDeleteActivityType,
  mockListTitleRecords,
  mockAddTitle,
} = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockListProjects: vi.fn(),
  mockCreateProject: vi.fn(),
  mockRenameProject: vi.fn(),
  mockSetProjectSO: vi.fn(),
  mockSetProjectTelegramNo: vi.fn(),
  mockDeleteProject: vi.fn(),
  mockListActivityTypes: vi.fn(),
  mockCreateActivityType: vi.fn(),
  mockRenameActivityType: vi.fn(),
  mockSetActivityTypeActive: vi.fn(),
  mockSetActivityTypeTelegramNo: vi.fn(),
  mockDeleteActivityType: vi.fn(),
  mockListTitleRecords: vi.fn(),
  mockAddTitle: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  withMobileActor: vi.fn(async (req: Request, fn: (auth: unknown) => Promise<unknown>, options?: unknown) => {
    const auth = (await mockRequire(req, options)) as { ok: boolean; response?: unknown }
    if (!auth.ok) return auth.response
    return fn(auth)
  }),
  withMobileSession: vi.fn(async (req: Request, fn: (auth: unknown) => Promise<unknown>) => {
    const auth = (await mockRequire(req, { allowInactive: true })) as { ok: boolean; response?: unknown }
    if (!auth.ok) return auth.response
    return fn(auth)
  }),
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
    listProjects: mockListProjects,
    createProject: mockCreateProject,
    renameProject: mockRenameProject,
    setProjectSO: mockSetProjectSO,
    setProjectTelegramNo: mockSetProjectTelegramNo,
    deleteProject: mockDeleteProject,
    listActivityTypes: mockListActivityTypes,
    createActivityType: mockCreateActivityType,
    renameActivityType: mockRenameActivityType,
    setActivityTypeActive: mockSetActivityTypeActive,
    setActivityTypeTelegramNo: mockSetActivityTypeTelegramNo,
    deleteActivityType: mockDeleteActivityType,
    listTitleRecords: mockListTitleRecords,
    addTitle: mockAddTitle,
  },
}))

import { GET as getProjects, POST as postProjects } from '@/app/api/v1/admin/projects/route'
import { PATCH as patchProject, DELETE as deleteProject } from '@/app/api/v1/admin/projects/[id]/route'
import { GET as getActivities, POST as postActivities } from '@/app/api/v1/admin/activity-types/route'
import { PATCH as patchActivity, DELETE as deleteActivity } from '@/app/api/v1/admin/activity-types/[id]/route'
import { POST as postTitles } from '@/app/api/v1/admin/titles/route'

describe('Slice 09: Mobile Reference Data Administration Routes', () => {
  const adminActor = {
    id: 'u-admin',
    email: 'admin@vsis.lk',
    role: 'admin' as const,
    permission_role: 'admin' as const,
    hierarchy_role: 'manager' as const,
    isActive: true,
  }

  const pmActor = {
    id: 'u-pm',
    email: 'pm@vsis.lk',
    role: 'pm' as const,
    permission_role: 'pm' as const,
    hierarchy_role: 'user' as const,
    isActive: true,
  }

  const userActor = {
    id: 'u-user',
    email: 'user@vsis.lk',
    role: 'user' as const,
    permission_role: 'user' as const,
    hierarchy_role: 'user' as const,
    isActive: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockRequire.mockResolvedValue({ ok: true, actor: adminActor })
    mockListProjects.mockResolvedValue([])
    mockListActivityTypes.mockResolvedValue([])
  })

interface MockResponse<T = Record<string, unknown>> {
  status: number
  body: {
    data?: T
    error?: { code?: string; message?: string } | null
  }
}

  describe('/api/v1/admin/projects', () => {
    it('authorizes admin and PM to list projects', async () => {
      mockListProjects.mockResolvedValueOnce([
        { id: 'p1', name: 'Alpha Project', so_number: 'SO-101', telegram_no: 1, created_at: '' },
      ])

      const resAdmin = (await getProjects(new Request('http://localhost/api/v1/admin/projects'))) as unknown as MockResponse<Array<{ id: string }>>
      expect(resAdmin.status).toBe(200)
      expect(resAdmin.body.data).toHaveLength(1)

      mockRequire.mockResolvedValueOnce({ ok: true, actor: pmActor })
      const resPm = (await getProjects(new Request('http://localhost/api/v1/admin/projects'))) as unknown as MockResponse
      expect(resPm.status).toBe(200)
    })

    it('rejects regular users with 403 Forbidden', async () => {
      mockRequire.mockResolvedValueOnce({ ok: true, actor: userActor })
      const res = (await getProjects(new Request('http://localhost/api/v1/admin/projects'))) as unknown as MockResponse
      expect(res.status).toBe(403)
    })

    it('creates project with optional SO number and telegram bot code in one atomic query', async () => {
      mockRequire.mockResolvedValueOnce({ ok: true, actor: pmActor })
      mockCreateProject.mockResolvedValueOnce({
        data: { id: 'p-new', name: 'Beta Project', so_number: 'SO-202', telegram_no: 3, created_at: '2026-09-01' },
        error: null,
      })

      const req = new Request('http://localhost/api/v1/admin/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Beta Project', soNumber: 'SO-202', telegramNo: 3 }),
      })

      const res = (await postProjects(req)) as unknown as MockResponse
      expect(res.status).toBe(201)
      expect(mockCreateProject).toHaveBeenCalledWith(pmActor, 'Beta Project', { soNumber: 'SO-202', telegramNo: 3 })
      expect(mockSetProjectSO).not.toHaveBeenCalled()
      expect(mockSetProjectTelegramNo).not.toHaveBeenCalled()
      expect(mockListProjects).not.toHaveBeenCalled()
      expect(res.body.data).toEqual({ id: 'p-new', name: 'Beta Project', so_number: 'SO-202', telegram_no: 3, created_at: '2026-09-01' })
    })

    it('returns 409 conflict when project name already exists', async () => {
      mockRequire.mockResolvedValueOnce({ ok: true, actor: pmActor })
      mockCreateProject.mockResolvedValueOnce({
        data: null,
        error: 'A record with that value already exists.',
      })

      const req = new Request('http://localhost/api/v1/admin/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Duplicate Project' }),
      })

      const res = (await postProjects(req)) as unknown as MockResponse
      expect(res.status).toBe(409)
      expect(res.body.error?.code).toBe('CONFLICT')
    })

    it('validates required project name', async () => {
      const req = new Request('http://localhost/api/v1/admin/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '   ' }),
      })

      const res = (await postProjects(req)) as unknown as MockResponse
      expect(res.status).toBe(400)
    })
  })

  describe('/api/v1/admin/projects/[id]', () => {
    it('updates project fields', async () => {
      mockRenameProject.mockResolvedValueOnce({ error: null })
      mockSetProjectSO.mockResolvedValueOnce({ error: null })
      mockListProjects.mockResolvedValueOnce([
        { id: 'p1', name: 'Renamed Project', so_number: 'SO-999', created_at: '' },
      ])

      const req = new Request('http://localhost/api/v1/admin/projects/p1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Project', soNumber: 'SO-999' }),
      })

      const res = (await patchProject(req, { params: Promise.resolve({ id: 'p1' }) })) as unknown as MockResponse
      expect(res.status).toBe(200)
      expect(mockRenameProject).toHaveBeenCalledWith(adminActor, 'p1', 'Renamed Project')
      expect(mockSetProjectSO).toHaveBeenCalledWith(adminActor, 'p1', 'SO-999')
    })

    it('returns 404 NOT_FOUND when project is gone on intervening delete during PATCH read-back', async () => {
      mockRenameProject.mockResolvedValueOnce({ error: null })
      mockListProjects.mockResolvedValueOnce([])

      const req = new Request('http://localhost/api/v1/admin/projects/p-intervening', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Project' }),
      })

      const res = (await patchProject(req, { params: Promise.resolve({ id: 'p-intervening' }) })) as unknown as MockResponse
      expect(res.status).toBe(404)
      expect(res.body.error?.code).toBe('NOT_FOUND')
      expect(res.body.error?.message).toMatch(/Project not found/i)
    })

    it('returns 409 conflict when deleting a referenced project', async () => {
      mockDeleteProject.mockResolvedValueOnce({
        error: 'Cannot delete: 5 entries reference this project.',
      })

      const req = new Request('http://localhost/api/v1/admin/projects/p1', {
        method: 'DELETE',
      })

      const res = (await deleteProject(req, { params: Promise.resolve({ id: 'p1' }) })) as unknown as MockResponse
      expect(res.status).toBe(409)
      expect(res.body.error?.message).toContain('5 entries reference this project')
    })
  })

  describe('/api/v1/admin/activity-types', () => {
    it('restricts activity type management to admins only (rejects PM with 403)', async () => {
      mockRequire.mockResolvedValueOnce({ ok: true, actor: pmActor })
      const resPm = (await getActivities(new Request('http://localhost/api/v1/admin/activity-types'))) as unknown as MockResponse
      expect(resPm.status).toBe(403)

      mockRequire.mockResolvedValueOnce({ ok: true, actor: adminActor })
      mockListActivityTypes.mockResolvedValueOnce([
        { id: 'act1', name: 'Coding', is_active: true },
      ])
      const resAdmin = (await getActivities(new Request('http://localhost/api/v1/admin/activity-types'))) as unknown as MockResponse
      expect(resAdmin.status).toBe(200)
    })

    it('creates activity type and assigns telegram bot number in one atomic query', async () => {
      mockCreateActivityType.mockResolvedValueOnce({
        data: { id: 'act-new', name: 'Architecture Review', is_active: true, telegram_no: 5, created_at: '2026-09-01' },
        error: null,
      })

      const req = new Request('http://localhost/api/v1/admin/activity-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Architecture Review', telegramNo: 5 }),
      })

      const res = (await postActivities(req)) as unknown as MockResponse
      expect(res.status).toBe(201)
      expect(mockCreateActivityType).toHaveBeenCalledWith(adminActor, 'Architecture Review', { telegramNo: 5 })
      expect(mockSetActivityTypeTelegramNo).not.toHaveBeenCalled()
      expect(mockListActivityTypes).not.toHaveBeenCalled()
      expect(res.body.data).toEqual({ id: 'act-new', name: 'Architecture Review', is_active: true, telegram_no: 5, created_at: '2026-09-01' })
    })

    it('returns 409 conflict when activity type already exists', async () => {
      mockCreateActivityType.mockResolvedValueOnce({
        data: null,
        error: 'A record with that value already exists.',
      })

      const req = new Request('http://localhost/api/v1/admin/activity-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Duplicate Activity' }),
      })

      const res = (await postActivities(req)) as unknown as MockResponse
      expect(res.status).toBe(409)
      expect(res.body.error?.code).toBe('CONFLICT')
    })

    it('modifies active status and deletes activity type', async () => {
      mockSetActivityTypeActive.mockResolvedValueOnce({ error: null })
      mockListActivityTypes.mockResolvedValueOnce([
        { id: 'act1', name: 'Coding', is_active: false },
      ])

      const patchReq = new Request('http://localhost/api/v1/admin/activity-types/act1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      })

      const patchRes = (await patchActivity(patchReq, { params: Promise.resolve({ id: 'act1' }) })) as unknown as MockResponse
      expect(patchRes.status).toBe(200)
      expect(mockSetActivityTypeActive).toHaveBeenCalledWith(adminActor, 'act1', false)

      // Intervening delete on activity type PATCH
      mockSetActivityTypeActive.mockResolvedValueOnce({ error: null })
      mockListActivityTypes.mockResolvedValueOnce([])
      const patchReqGone = new Request('http://localhost/api/v1/admin/activity-types/act-gone', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      })
      const patchResGone = (await patchActivity(patchReqGone, { params: Promise.resolve({ id: 'act-gone' }) })) as unknown as MockResponse
      expect(patchResGone.status).toBe(404)
      expect(patchResGone.body.error?.code).toBe('NOT_FOUND')
      expect(patchResGone.body.error?.message).toMatch(/Activity type not found/i)

      mockDeleteActivityType.mockResolvedValueOnce({ error: null })
      const delReq = new Request('http://localhost/api/v1/admin/activity-types/act1', {
        method: 'DELETE',
      })
      const delRes = (await deleteActivity(delReq, { params: Promise.resolve({ id: 'act1' }) })) as unknown as MockResponse
      expect(delRes.status).toBe(200)
    })
  })

  describe('/api/v1/admin/titles', () => {
    const origSuper = process.env.SUPER_ADMIN_EMAIL
    beforeEach(() => {
      process.env.SUPER_ADMIN_EMAIL = 'admin@vsis.lk'
    })
    afterEach(() => {
      process.env.SUPER_ADMIN_EMAIL = origSuper
    })

    it('creates title atomically returning row directly', async () => {
      const superAdminActor = { ...adminActor, email: 'admin@vsis.lk' }
      mockRequire.mockResolvedValueOnce({ ok: true, actor: superAdminActor })
      mockAddTitle.mockResolvedValueOnce({
        data: { id: 't-1', name: 'Principal Architect', hierarchy_role: 'manager', created_at: '2026-09-01' },
        error: null,
      })

      const req = new Request('http://localhost/api/v1/admin/titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Principal Architect', hierarchyRole: 'manager' }),
      })

      const res = (await postTitles(req)) as unknown as MockResponse
      expect(res.status).toBe(201)
      expect(mockAddTitle).toHaveBeenCalledWith(superAdminActor, 'Principal Architect', 'manager')
      expect(mockListTitleRecords).not.toHaveBeenCalled()
      expect(res.body.data).toEqual({ id: 't-1', name: 'Principal Architect', hierarchy_role: 'manager', created_at: '2026-09-01' })
    })

    it('returns 409 conflict when title creation fails', async () => {
      const superAdminActor = { ...adminActor, email: 'admin@vsis.lk' }
      mockRequire.mockResolvedValueOnce({ ok: true, actor: superAdminActor })
      mockAddTitle.mockResolvedValueOnce({
        data: null,
        error: 'Conflict: title exists',
      })

      const req = new Request('http://localhost/api/v1/admin/titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Duplicate Title', hierarchyRole: 'user' }),
      })

      const res = (await postTitles(req)) as unknown as MockResponse
      expect(res.status).toBe(409)
      expect(res.body.error?.code).toBe('CONFLICT')
    })
  })
})
