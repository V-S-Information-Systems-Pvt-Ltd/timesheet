import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockList } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockList: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { data: null, error: { code, message } },
    status,
  })),
  serverError: vi.fn(() => ({ status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    listProfiles: mockList,
  },
}))

import { GET } from '@/app/api/v1/people/route'

const managerActor = {
  id: 'mgr-1',
  email: 'lead@example.com',
  role: 'manager',
  permission_role: 'user',
  hierarchy_role: 'manager',
  isActive: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequire.mockResolvedValue({ ok: true, actor: managerActor, sessionId: 'session-1' })
  mockList.mockResolvedValue([
    {
      id: 'emp-1',
      email: 'dev@example.com',
      name: 'Developer One',
      role: 'user',
      permission_role: 'user',
      hierarchy_role: 'user',
      department: 'Engineering',
      title: 'Software Engineer',
      manager_id: 'mgr-1',
      isActive: true,
    },
  ])
})

describe('GET /api/v1/people', () => {
  it('returns sanitized team profiles for authorized manager', async () => {
    const response = (await GET(new Request('http://localhost/api/v1/people'))) as unknown as {
      status: number
      body: { data: Array<{ id: string; name: string; managerId: string }> }
    }

    expect(response.status).toBe(200)
    expect(response.body.data).toHaveLength(1)
    expect(response.body.data[0].name).toBe('Developer One')
    expect(response.body.data[0].managerId).toBe('mgr-1')
    expect(mockList).toHaveBeenCalledWith(managerActor)
  })

  it('rejects a pure PM without leadership hierarchy role with 403', async () => {
    const pmActor = {
      id: 'pm-1',
      email: 'pm@example.com',
      role: 'pm',
      permission_role: 'pm',
      hierarchy_role: 'user',
      isActive: true,
    }
    mockRequire.mockResolvedValue({ ok: true, actor: pmActor, sessionId: 'session-1' })

    const response = (await GET(new Request('http://localhost/api/v1/people'))) as unknown as {
      status: number
      body: { error: { code: string; message: string } }
    }

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
    expect(mockList).not.toHaveBeenCalled()
  })

  it('rejects a regular user with 403', async () => {
    const regularUser = {
      id: 'user-1',
      email: 'user@example.com',
      role: 'user',
      permission_role: 'user',
      hierarchy_role: 'user',
      isActive: true,
    }
    mockRequire.mockResolvedValue({ ok: true, actor: regularUser, sessionId: 'session-1' })

    const response = (await GET(new Request('http://localhost/api/v1/people'))) as unknown as {
      status: number
      body: { error: { code: string; message: string } }
    }

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
    expect(mockList).not.toHaveBeenCalled()
  })

  it('permits an admin to view team profiles', async () => {
    const adminActor = {
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
      permission_role: 'admin',
      hierarchy_role: 'user',
      isActive: true,
    }
    mockRequire.mockResolvedValue({ ok: true, actor: adminActor, sessionId: 'session-1' })

    const response = (await GET(new Request('http://localhost/api/v1/people'))) as unknown as {
      status: number
      body: { data: unknown[] }
    }

    expect(response.status).toBe(200)
    expect(mockList).toHaveBeenCalledWith(adminActor)
  })
})
