import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockList } = vi.hoisted(() => ({ mockRequire: vi.fn(), mockList: vi.fn() }))
vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  serverError: vi.fn(() => ({ status: 500 })),
}))
vi.mock('@/lib/db', () => ({ repo: { listTimesheets: mockList } }))

import { GET } from '@/app/api/v1/dashboard/route'

const actor = {
  id: 'user-1',
  email: 'u@example.com',
  role: 'user' as const,
  permission_role: 'user' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
  mockList.mockResolvedValue({
    rows: [
      {
        id: 't1',
        user_id: 'user-1',
        project_id: 'p1',
        activity_type_id: 'a1',
        log_date: new Date().toISOString().slice(0, 10),
        hours_worked: 4,
        work_done: 'Feature work',
        created_at: '2026-08-27T10:00:00Z',
        projects: { name: 'Project Alpha' },
        activity_types: { name: 'Development' },
        profiles: { email: 'u@example.com' },
      },
      {
        id: 't2',
        user_id: 'user-1',
        project_id: 'p2',
        activity_type_id: null,
        log_date: '2000-01-01',
        hours_worked: 3,
        work_done: 'Legacy work',
        created_at: '2000-01-01T10:00:00Z',
      },
    ],
    count: 2,
  })
})

describe('GET /api/v1/dashboard', () => {
  it('returns personal totals, mapped recent entries, and actor capabilities', async () => {
    const response = (await GET(new Request('http://localhost/api/v1/dashboard'))) as unknown as {
      status: number
      body: {
        data: {
          actor: {
            id: string
            email: string
            capabilities: { canViewTeam: boolean; canManageProjects: boolean }
          }
          today: { hours: number }
          week: { hours: number }
          recentEntries: Array<{
            id: string
            project_name?: string
            activity_name?: string
            hours_worked: number
            work_done: string
          }>
        }
      }
    }
    expect(response.status).toBe(200)
    expect(response.body.data.actor.id).toBe('user-1')
    expect(response.body.data.actor.capabilities.canViewTeam).toBe(false)
    expect(response.body.data.actor.capabilities.canManageProjects).toBe(false)
    expect(response.body.data.today.hours).toBe(4)
    expect(response.body.data.week.hours).toBe(7)
    expect(response.body.data.recentEntries).toHaveLength(2)
    expect(response.body.data.recentEntries[0]).toEqual({
      id: 't1',
      user_id: 'user-1',
      user_email: 'u@example.com',
      project_id: 'p1',
      project_name: 'Project Alpha',
      activity_type_id: 'a1',
      activity_name: 'Development',
      log_date: new Date().toISOString().slice(0, 10),
      hours_worked: 4,
      work_done: 'Feature work',
      created_at: '2026-08-27T10:00:00Z',
    })
    expect(mockList).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ limit: 20, userId: 'user-1' })
    )
    expect(mockList).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ limit: 100, userId: 'user-1' })
    )
  })
})
