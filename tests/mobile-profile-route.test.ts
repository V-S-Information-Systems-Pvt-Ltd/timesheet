import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWithMobileActor, mockGetSelfProfile, mockPeopleDeps } = vi.hoisted(() => ({
  mockWithMobileActor: vi.fn(),
  mockGetSelfProfile: vi.fn(),
  mockPeopleDeps: vi.fn(() => ({ persistence: {}, identity: {} })),
}))

vi.mock('@/app/api/v1/_http', () => ({
  withMobileActor: mockWithMobileActor,
  apiSuccess: vi.fn((data: unknown, status = 200) => ({ body: { data, error: null }, status })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { data: null, error: { code, message } },
    status,
  })),
  serverError: vi.fn(() => ({ status: 500 })),
}))

vi.mock('@/lib/db/people', () => ({
  peopleDeps: mockPeopleDeps,
}))

vi.mock('@/lib/domain/people', () => ({
  getSelfProfileDomain: mockGetSelfProfile,
}))

import { GET } from '@/app/api/v1/profile/route'

const actor = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'engineer',
  isActive: false,
}

const profile = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'User One',
  department: 'Engineering',
  title: 'Engineer',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'engineer',
  is_active: false,
  manager_id: null,
  dashboard_layout: null,
  admin_layout: null,
  mobile_layout: null,
  created_at: '2026-09-26T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithMobileActor.mockImplementation(async (
    _request: Request,
    handler: (auth: { actor: typeof actor; via: 'cookie' | 'bearer' }) => Promise<unknown>,
  ) => handler({ actor, via: 'cookie' }))
  mockGetSelfProfile.mockResolvedValue({ ok: true, data: profile })
})

describe('GET /api/v1/profile', () => {
  it('allows cookie auth plus inactive signed-in actors and returns the full browser profile shape', async () => {
    const request = new Request('http://localhost/api/v1/profile', {
      headers: { cookie: 'session=1' },
    })
    const response = await GET(request) as unknown as {
      status: number
      body: { data: typeof profile; error: null }
    }

    expect(mockWithMobileActor).toHaveBeenCalledWith(
      request,
      expect.any(Function),
      { allowCookie: true, allowInactive: true }
    )
    expect(mockGetSelfProfile).toHaveBeenCalledWith(actor, mockPeopleDeps.mock.results[0].value)
    expect(response).toEqual({ status: 200, body: { data: profile, error: null } })
  })

  it('preserves bearer access through the same domain path', async () => {
    mockWithMobileActor.mockImplementationOnce(async (
      _request: Request,
      handler: (auth: { actor: typeof actor; via: 'bearer' }) => Promise<unknown>,
    ) => handler({ actor: { ...actor, isActive: true }, via: 'bearer' }))

    await GET(new Request('http://localhost/api/v1/profile', {
      headers: { authorization: 'Bearer access' },
    }))

    expect(mockGetSelfProfile).toHaveBeenCalledWith(
      { ...actor, isActive: true },
      expect.any(Object)
    )
  })
})
