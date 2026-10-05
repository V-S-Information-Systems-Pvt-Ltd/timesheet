import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWithMobileActor, mockGetBackfillSettings, mockWorkspaceDeps } = vi.hoisted(() => ({
  mockWithMobileActor: vi.fn(),
  mockGetBackfillSettings: vi.fn(),
  mockWorkspaceDeps: vi.fn(() => ({ persistence: {} })),
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

vi.mock('@/lib/db/workspace', () => ({
  workspaceDeps: mockWorkspaceDeps,
}))

vi.mock('@/lib/domain/workspace', () => ({
  getBackfillSettings: mockGetBackfillSettings,
}))

import { GET } from '@/app/api/v1/settings/backfill/route'

const actor = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'engineer',
  isActive: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithMobileActor.mockImplementation(async (
    _request: Request,
    handler: (auth: { actor: typeof actor; via: 'cookie' | 'bearer' }) => Promise<unknown>,
  ) => handler({ actor, via: 'cookie' }))
  mockGetBackfillSettings.mockResolvedValue({
    ok: true,
    data: { mode: 'days', windowDays: 7, extraDays: 1 },
  })
})

describe('GET /api/v1/settings/backfill', () => {
  it('opts into cookie authentication and preserves the existing response shape', async () => {
    const request = new Request('http://localhost/api/v1/settings/backfill', {
      headers: { cookie: 'session=1' },
    })
    const response = await GET(request) as unknown as {
      status: number
      body: {
        data: { mode: string; windowDays: number; extraDays: number }
        error: null
      }
    }

    expect(mockWithMobileActor).toHaveBeenCalledWith(
      request,
      expect.any(Function),
      { allowCookie: true }
    )
    expect(mockGetBackfillSettings).toHaveBeenCalledWith(actor, mockWorkspaceDeps.mock.results[0].value)
    expect(response).toEqual({
      status: 200,
      body: {
        data: { mode: 'days', windowDays: 7, extraDays: 1 },
        error: null,
      },
    })
  })

  it('uses the same active-user domain path for bearer callers', async () => {
    mockWithMobileActor.mockImplementationOnce(async (
      _request: Request,
      handler: (auth: { actor: typeof actor; via: 'bearer' }) => Promise<unknown>,
    ) => handler({ actor, via: 'bearer' }))

    await GET(new Request('http://localhost/api/v1/settings/backfill', {
      headers: { authorization: 'Bearer access' },
    }))

    expect(mockGetBackfillSettings).toHaveBeenCalledWith(actor, expect.any(Object))
  })
})
