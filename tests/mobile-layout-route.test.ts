import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockGetMobileLayout, mockSetMobileLayout, mockGetDefaultLayouts } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockGetMobileLayout: vi.fn(),
  mockSetMobileLayout: vi.fn(),
  mockGetDefaultLayouts: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { error: { code, message } },
    status,
  })),
  serverError: vi.fn((err: unknown) => ({ body: { error: err }, status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    getMobileLayout: mockGetMobileLayout,
    setMobileLayout: mockSetMobileLayout,
    getDefaultLayouts: mockGetDefaultLayouts,
  },
}))

import { GET, PUT } from '@/app/api/v1/layout/route'
import { DEFAULT_MOBILE_LAYOUT } from '@/lib/layout'
import type { MobileLayout, MobileModuleSetting } from '@/app/types'

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
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1', requestId: 'req-1' })
  mockGetMobileLayout.mockResolvedValue({ data: null, error: null })
  mockGetDefaultLayouts.mockResolvedValue({
    data: { dashboard: { tiles: [] }, admin: { tiles: [] }, mobile: DEFAULT_MOBILE_LAYOUT },
    error: null,
  })
  mockSetMobileLayout.mockResolvedValue({ error: null })
})

describe('/api/v1/layout', () => {
  it('returns default and effective layout on GET', async () => {
    const response = (await GET(
      new Request('http://localhost/api/v1/layout')
    )) as unknown as {
      status: number
      body: { data: { layout: MobileLayout; defaultLayout: MobileLayout } }
    }

    expect(response.status).toBe(200)
    expect(mockGetMobileLayout).toHaveBeenCalledWith(actor)
    expect(mockGetDefaultLayouts).toHaveBeenCalledWith(actor)
    expect(response.body.data.layout).toBeDefined()
    expect(response.body.data.layout.modules.some((m) => m.id === 'log-time')).toBe(true)
  })

  it('saves custom layout and forces essential modules enabled on PUT', async () => {
    const customLayout: MobileLayout = {
      modules: [
        { id: 'log-time', enabled: false, placement: 'more' },
        { id: 'timesheets', enabled: true, placement: 'home' },
        { id: 'leaves', enabled: false, placement: 'more' },
      ],
    }

    const response = (await PUT(
      new Request('http://localhost/api/v1/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: customLayout }),
      })
    )) as unknown as {
      status: number
      body: { data: { layout: MobileLayout } }
    }

    expect(response.status).toBe(200)
    expect(mockSetMobileLayout).toHaveBeenCalled()
    const savedArg = mockSetMobileLayout.mock.calls[0][1] as MobileLayout
    const logTime = savedArg.modules.find((m: MobileModuleSetting) => m.id === 'log-time')
    expect(logTime?.enabled).toBe(true)
  })

  it('resets custom layout when reset: true is passed on PUT', async () => {
    const response = (await PUT(
      new Request('http://localhost/api/v1/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      })
    )) as unknown as { status: number; body: { data: { savedLayout: null } } }

    expect(response.status).toBe(200)
    expect(mockSetMobileLayout).toHaveBeenCalledWith(actor, null)
    expect(response.body.data.savedLayout).toBeNull()
  })
})
