import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockList } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockList: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  serverError: vi.fn(() => ({ status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    listProfiles: mockList,
  },
}))

import { GET } from '@/app/api/v1/people/route'

const actor = {
  id: 'mgr-1',
  email: 'lead@example.com',
  role: 'manager',
  permission_role: 'user',
  hierarchy_role: 'manager',
  isActive: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
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
  it('returns sanitized team profiles for authorized leader', async () => {
    const response = (await GET(new Request('http://localhost/api/v1/people'))) as unknown as {
      status: number
      body: { data: Array<{ id: string; name: string; managerId: string }> }
    }

    expect(response.status).toBe(200)
    expect(response.body.data).toHaveLength(1)
    expect(response.body.data[0].name).toBe('Developer One')
    expect(response.body.data[0].managerId).toBe('mgr-1')
    expect(mockList).toHaveBeenCalledWith(actor)
  })
})
