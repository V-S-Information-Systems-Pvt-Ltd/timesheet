import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockGetMobileLayout, mockSetMobileLayout, mockGetDefaultLayouts, mockSetDefaultLayouts } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockGetMobileLayout: vi.fn(),
  mockSetMobileLayout: vi.fn(),
  mockGetDefaultLayouts: vi.fn(),
  mockSetDefaultLayouts: vi.fn(),
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
    setDefaultLayouts: mockSetDefaultLayouts,
  },
}))

import { GET as getPersonalLayout, PUT as putPersonalLayout } from '@/app/api/v1/layout/route'
import { GET as getAdminLayout, PUT as putAdminLayout } from '@/app/api/v1/admin/layout/route'
import { DEFAULT_MOBILE_LAYOUT, sanitizeMobileLayout } from '@/lib/layout'
import type { MobileLayout, MobileModuleSetting } from '@/app/types'

const actor = {
  id: 'user-1',
  email: 'u@example.com',
  role: 'user' as const,
  permission_role: 'user' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

const adminActor = {
  id: 'admin-1',
  email: 'admin@vsis.lk',
  role: 'admin' as const,
  permission_role: 'admin' as const,
  hierarchy_role: 'manager' as const,
  isActive: true,
}

const superAdminActor = {
  id: 'super-1',
  email: 'superadmin@vsis.lk',
  role: 'admin' as const,
  permission_role: 'admin' as const,
  hierarchy_role: 'manager' as const,
  isActive: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SUPER_ADMIN_EMAIL', 'superadmin@vsis.lk')
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1', requestId: 'req-1' })
  mockGetMobileLayout.mockResolvedValue({ data: null, error: null })
  mockGetDefaultLayouts.mockResolvedValue({
    data: { dashboard: { tiles: [] }, admin: { tiles: [] }, mobile: DEFAULT_MOBILE_LAYOUT },
    error: null,
  })
  mockSetMobileLayout.mockResolvedValue({ error: null })
  mockSetDefaultLayouts.mockResolvedValue({ error: null })
})

describe('/api/v1/layout (Personal Layout Override)', () => {
  it('returns default and effective layout on GET', async () => {
    const response = (await getPersonalLayout(
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

    const response = (await putPersonalLayout(
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
    const response = (await putPersonalLayout(
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

describe('/api/v1/admin/layout (Workspace Default Layout Administration)', () => {
  it('returns default layout on GET', async () => {
    const response = (await getAdminLayout(
      new Request('http://localhost/api/v1/admin/layout')
    )) as unknown as {
      status: number
      body: { data: { layout: MobileLayout } }
    }

    expect(response.status).toBe(200)
    expect(response.body.data.layout).toBeDefined()
    expect(response.body.data.layout.modules.length).toBe(DEFAULT_MOBILE_LAYOUT.modules.length)
  })

  it('rejects PUT from non-superadmin actors with 403 Forbidden', async () => {
    mockRequire.mockResolvedValueOnce({ ok: true, actor: adminActor, sessionId: 's-1', requestId: 'r-1' })

    const response = (await putAdminLayout(
      new Request('http://localhost/api/v1/admin/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: DEFAULT_MOBILE_LAYOUT }),
      })
    )) as unknown as { status: number; body: { error: { code: string; message: string } } }

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('allows super-admin to update default mobile layout', async () => {
    mockRequire.mockResolvedValueOnce({ ok: true, actor: superAdminActor, sessionId: 's-1', requestId: 'r-1' })

    const newLayout: MobileLayout = {
      modules: [
        { id: 'timesheets', enabled: true, placement: 'home' },
        { id: 'log-time', enabled: true, placement: 'home' },
      ],
    }

    const response = (await putAdminLayout(
      new Request('http://localhost/api/v1/admin/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: newLayout }),
      })
    )) as unknown as { status: number; body: { data: { layout: MobileLayout } } }

    expect(response.status).toBe(200)
    expect(response.body.data.layout).toBeDefined()
    const sanitized = response.body.data.layout
    expect(sanitized.modules.length).toBe(DEFAULT_MOBILE_LAYOUT.modules.length)
  })

  it('allows super-admin to reset default mobile layout with reset: true', async () => {
    mockRequire.mockResolvedValueOnce({ ok: true, actor: superAdminActor, sessionId: 's-1', requestId: 'r-1' })

    const response = (await putAdminLayout(
      new Request('http://localhost/api/v1/admin/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      })
    )) as unknown as { status: number; body: { data: { layout: MobileLayout } } }

    expect(response.status).toBe(200)
    expect(response.body.data.layout).toEqual(DEFAULT_MOBILE_LAYOUT)
  })
})

describe('sanitizeMobileLayout', () => {
  it('deduplicates module IDs, forces essential modules enabled, and appends missing defaults', () => {
    const raw = {
      modules: [
        { id: 'log-time', enabled: false, placement: 'more' },
        { id: 'log-time', enabled: true, placement: 'home' }, // duplicate should be ignored
        { id: 'unknown-module', enabled: true, placement: 'home' }, // unknown should be ignored
        { id: 'leaves', enabled: false, placement: 'home' },
      ],
    }

    const sanitized = sanitizeMobileLayout(raw, DEFAULT_MOBILE_LAYOUT)
    expect(sanitized).not.toBeNull()
    expect(sanitized!.modules.length).toBe(DEFAULT_MOBILE_LAYOUT.modules.length)

    const logTime = sanitized!.modules.find((m) => m.id === 'log-time')
    expect(logTime?.enabled).toBe(true)

    const leaves = sanitized!.modules.find((m) => m.id === 'leaves')
    expect(leaves?.enabled).toBe(false)
    expect(leaves?.placement).toBe('home')

    expect(sanitized!.modules.some((m: { id: string }) => m.id === 'unknown-module')).toBe(false)
  })
})
