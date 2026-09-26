import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWithMobileActor, mockGetReference } = vi.hoisted(() => ({
  mockWithMobileActor: vi.fn(),
  mockGetReference: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  withMobileActor: mockWithMobileActor,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  serverError: vi.fn(() => ({ status: 500 })),
}))

vi.mock('@/lib/api/v1/services/reference', () => ({
  getReferenceService: mockGetReference,
}))

import { GET } from '@/app/api/v1/reference/route'

const actor = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'user',
  isActive: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithMobileActor.mockImplementation(async (
    _request: Request,
    handler: (auth: { actor: typeof actor }) => Promise<unknown>,
  ) => handler({ actor }))
  mockGetReference.mockResolvedValue({
    projects: [{
      id: 'p1',
      name: 'Alpha',
      so_number: null,
      telegram_no: null,
      created_at: '2026-09-26T00:00:00.000Z',
    }],
    activityTypes: [],
    titles: [],
    titleItems: [],
  })
})

describe('GET /api/v1/reference', () => {
  it('opts into browser cookie authentication and preserves project fields', async () => {
    const request = new Request('http://localhost/api/v1/reference', { headers: { cookie: 'session=1' } })
    const response = await GET(request) as unknown as {
      status: number
      body: { data: { projects: Array<{ created_at: string }> }; error: null }
    }

    expect(mockWithMobileActor).toHaveBeenCalledWith(
      request,
      expect.any(Function),
      { allowCookie: true }
    )
    expect(mockGetReference).toHaveBeenCalledWith(actor, { allActivityTypes: false })
    expect(response.status).toBe(200)
    expect(response.body.data.projects[0].created_at).toBe('2026-09-26T00:00:00.000Z')
  })

  it('forwards all=1 as the explicit all-activity-types mode', async () => {
    const request = new Request('http://localhost/api/v1/reference?all=1', { headers: { cookie: 'session=1' } })
    await GET(request)

    expect(mockGetReference).toHaveBeenCalledWith(actor, { allActivityTypes: true })
  })
})
