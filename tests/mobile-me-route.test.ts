import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockRequire, mockUpdateMyProfile, mockGetProfileById } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockUpdateMyProfile: vi.fn(),
  mockGetProfileById: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  requireMobileSession: mockRequire,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  apiError: vi.fn((code: string, message: string, status = 400) => ({ body: { data: null, error: { code, message } }, status })),
  serverError: vi.fn(() => ({ status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    updateMyProfile: mockUpdateMyProfile,
    getProfileById: mockGetProfileById,
  },
}))

import { GET, PATCH } from '@/app/api/v1/auth/me/route'

describe('GET & PATCH /api/v1/auth/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes through authentication failures', async () => {
    const response = { status: 401 }
    mockRequire.mockResolvedValue({ ok: false, response })
    await expect(GET(new Request('http://localhost'))).resolves.toBe(response)
  })

  it('returns the current actor DTO', async () => {
    mockRequire.mockResolvedValue({
      ok: true,
      sessionId: 'session-1',
      actor: {
        id: 'user-1',
        email: 'u@example.com',
        role: 'user',
        permission_role: 'user',
        hierarchy_role: 'user',
        isActive: true,
      },
    })
    const response = (await GET(new Request('http://localhost'))) as unknown as { status: number; body: { data: Record<string, unknown> } }
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({
      id: 'user-1',
      email: 'u@example.com',
      name: null,
      department: null,
      title: null,
      managerId: null,
      role: 'user',
      permissionRole: 'user',
      hierarchyRole: 'user',
      isActive: true,
      capabilities: {
        canViewTeam: false,
        canManageProjects: false,
        canManageActivities: false,
        canManageUsers: false,
        canManageSettings: false,
        canManageWorkspaceCustomization: false,
      },
    })
  })

  it('PATCH updates department and title', async () => {
    const actor = {
      id: 'user-1',
      email: 'u@example.com',
      role: 'user',
      permission_role: 'user',
      hierarchy_role: 'user',
      isActive: true,
      department: 'Engineering',
      title: 'Engineer',
    }
    mockRequire.mockResolvedValue({ ok: true, actor })
    mockUpdateMyProfile.mockResolvedValue({ error: null })
    mockGetProfileById.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
      name: 'User 1',
      department: 'Delivery',
      title: 'Senior Engineer',
      role: 'user',
      is_active: true,
    })

    const req = new Request('http://localhost/api/v1/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ department: 'Delivery', title: 'Senior Engineer' }),
    })
    const response = (await PATCH(req)) as unknown as { status: number; body: { data: Record<string, unknown> } }
    expect(response.status).toBe(200)
    expect(mockUpdateMyProfile).toHaveBeenCalledWith(actor, { department: 'Delivery', title: 'Senior Engineer' })
    expect(response.body.data).toMatchObject({
      department: 'Delivery',
      title: 'Senior Engineer',
    })
  })
})
