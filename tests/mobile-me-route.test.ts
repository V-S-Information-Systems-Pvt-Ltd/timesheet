import { describe, expect, it, vi } from 'vitest'

const { mockRequire } = vi.hoisted(() => ({ mockRequire: vi.fn() }))
vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  requireMobileSession: mockRequire,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  serverError: vi.fn(() => ({ status: 500 })),
}))

import { GET } from '@/app/api/v1/auth/me/route'

describe('GET /api/v1/auth/me', () => {
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
      },
    })
  })

  it('returns actor DTO for an inactive pending user', async () => {
    mockRequire.mockResolvedValue({
      ok: true,
      sessionId: 'session-2',
      actor: {
        id: 'user-pending',
        email: 'pending@example.com',
        role: 'user',
        permission_role: 'user',
        hierarchy_role: 'user',
        isActive: false,
      },
    })
    const response = (await GET(new Request('http://localhost'))) as unknown as { status: number; body: { data: Record<string, unknown> } }
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({
      id: 'user-pending',
      email: 'pending@example.com',
      role: 'user',
      permissionRole: 'user',
      hierarchyRole: 'user',
      isActive: false,
      capabilities: {
        canViewTeam: false,
        canManageProjects: false,
        canManageActivities: false,
        canManageUsers: false,
        canManageSettings: false,
      },
    })
  })
})
