import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockGetBranding, mockSetBranding } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockGetBranding: vi.fn(),
  mockSetBranding: vi.fn(),
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
    getBranding: mockGetBranding,
    setBranding: mockSetBranding,
  },
}))

import { GET as getConfig } from '@/app/api/v1/config/route'
import { GET as getAdminBranding, PUT as putAdminBranding } from '@/app/api/v1/admin/branding/route'
import { DEFAULT_BRANDING } from '@/lib/branding'
import type { WorkspaceBranding } from '@/app/types'

const superAdminActor = {
  id: 'super-1',
  email: 'superadmin@vsis.lk',
  role: 'admin' as const,
  permission_role: 'admin' as const,
  hierarchy_role: 'manager' as const,
  isActive: true,
}

const ordinaryAdminActor = {
  id: 'admin-1',
  email: 'admin@vsis.lk',
  role: 'admin' as const,
  permission_role: 'admin' as const,
  hierarchy_role: 'manager' as const,
  isActive: true,
}

const coActor = {
  id: 'co-1',
  email: 'co@vsis.lk',
  role: 'admin' as const,
  permission_role: 'co' as const,
  hierarchy_role: 'manager' as const,
  isActive: true,
}

const pmActor = {
  id: 'pm-1',
  email: 'pm@vsis.lk',
  role: 'user' as const,
  permission_role: 'pm' as const,
  hierarchy_role: 'manager' as const,
  isActive: true,
}

const leaderActor = {
  id: 'lead-1',
  email: 'leader@vsis.lk',
  role: 'user' as const,
  permission_role: 'user' as const,
  hierarchy_role: 'team_lead' as const,
  isActive: true,
}

const engineerActor = {
  id: 'eng-1',
  email: 'engineer@vsis.lk',
  role: 'user' as const,
  permission_role: 'user' as const,
  hierarchy_role: 'engineer' as const,
  isActive: true,
}

const inactiveSuperAdminActor = {
  id: 'super-1',
  email: 'superadmin@vsis.lk',
  role: 'admin' as const,
  permission_role: 'admin' as const,
  hierarchy_role: 'manager' as const,
  isActive: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPER_ADMIN_EMAIL = 'superadmin@vsis.lk'
  mockGetBranding.mockResolvedValue({ data: DEFAULT_BRANDING, error: null })
  mockSetBranding.mockResolvedValue({ error: null })
})

describe('workspace branding endpoints', () => {
  it('exposes safe branding in public /api/v1/config', async () => {
    mockGetBranding.mockResolvedValueOnce({
      data: {
        appName: 'Acme Corp',
        primaryColor: '#0D9488',
        logoUrl: 'https://example.com/logo.png',
      },
      error: null,
    })

    const res = await getConfig()
    const json = (await res.json()) as { data: { branding: WorkspaceBranding } }

    expect(json.data.branding).toEqual({
      appName: 'Acme Corp',
      primaryColor: '#0D9488',
      logoUrl: 'https://example.com/logo.png',
    })
  })

  describe('role-matrix authorization for /api/v1/admin/branding', () => {
    it('authorizes active super-admin on GET and PUT', async () => {
      mockRequire.mockResolvedValueOnce({ ok: true, actor: superAdminActor, requestId: 'req-1' })
      const resGet = (await getAdminBranding(new Request('http://localhost/api/v1/admin/branding'))) as unknown as {
        status: number
        body: { data: WorkspaceBranding }
      }
      expect(resGet.status).toBe(200)
      expect(resGet.body.data).toEqual(DEFAULT_BRANDING)

      const newBranding: WorkspaceBranding = {
        appName: 'VSIS Timesheet',
        primaryColor: '#EA2B32',
        logoUrl: 'https://vsis.lk/logo.png',
      }
      mockRequire.mockResolvedValueOnce({ ok: true, actor: superAdminActor, requestId: 'req-2' })
      const resPut = (await putAdminBranding(
        new Request('http://localhost/api/v1/admin/branding', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branding: newBranding }),
        })
      )) as unknown as { status: number; body: { data: WorkspaceBranding } }
      expect(resPut.status).toBe(200)
      expect(mockSetBranding).toHaveBeenCalledWith(superAdminActor, newBranding)
    })

    it.each([
      ['ordinary admin', ordinaryAdminActor],
      ['CO', coActor],
      ['PM', pmActor],
      ['leader', leaderActor],
      ['engineer', engineerActor],
      ['inactive super admin', inactiveSuperAdminActor],
    ])('rejects %s with 403 Forbidden', async (_label, actor) => {
      mockRequire.mockResolvedValueOnce({ ok: true, actor, requestId: 'req-forbidden' })
      const resGet = (await getAdminBranding(new Request('http://localhost/api/v1/admin/branding'))) as unknown as {
        status: number
        body: { error: { code: string } }
      }
      expect(resGet.status).toBe(403)
      expect(resGet.body.error.code).toBe('FORBIDDEN')

      mockRequire.mockResolvedValueOnce({ ok: true, actor, requestId: 'req-forbidden-put' })
      const resPut = (await putAdminBranding(
        new Request('http://localhost/api/v1/admin/branding', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reset: true }),
        })
      )) as unknown as { status: number; body: { error: { code: string } } }
      expect(resPut.status).toBe(403)
      expect(resPut.body.error.code).toBe('FORBIDDEN')
    })

    it('rejects unauthenticated requests with 401 Auth Required', async () => {
      mockRequire.mockResolvedValueOnce({
        ok: false,
        response: { status: 401, body: { error: { code: 'AUTH_REQUIRED' } } },
      })
      const res = (await getAdminBranding(new Request('http://localhost/api/v1/admin/branding'))) as unknown as {
        status: number
      }
      expect(res.status).toBe(401)
    })
  })

  it('validates and rejects invalid branding with 400 VALIDATION_ERROR', async () => {
    mockRequire.mockResolvedValueOnce({ ok: true, actor: superAdminActor, requestId: 'req-1' })
    const invalidBranding = {
      appName: '',
      primaryColor: 'not-a-color',
      logoUrl: 'http://insecure.com/logo.png',
    }

    const res = (await putAdminBranding(
      new Request('http://localhost/api/v1/admin/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branding: invalidBranding }),
      })
    )) as unknown as { status: number; body: { error: { code: string; fieldErrors: Record<string, string> } } }

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(mockSetBranding).not.toHaveBeenCalled()
  })

  it('resets branding to defaults on reset: true', async () => {
    mockRequire.mockResolvedValueOnce({ ok: true, actor: superAdminActor, requestId: 'req-1' })
    const res = (await putAdminBranding(
      new Request('http://localhost/api/v1/admin/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      })
    )) as unknown as { status: number; body: { data: WorkspaceBranding } }

    expect(res.status).toBe(200)
    expect(mockSetBranding).toHaveBeenCalledWith(superAdminActor, DEFAULT_BRANDING)
    expect(res.body.data).toEqual(DEFAULT_BRANDING)
  })
})
