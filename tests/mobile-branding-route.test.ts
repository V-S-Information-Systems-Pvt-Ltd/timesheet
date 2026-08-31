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

const adminActor = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'admin' as const,
  permission_role: 'admin' as const,
  hierarchy_role: 'manager' as const,
  isActive: true,
}

const userActor = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'user' as const,
  permission_role: 'user' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

beforeEach(() => {
  vi.clearAllMocks()
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

  it('rejects non-admin access to admin branding route with 403', async () => {
    mockRequire.mockResolvedValueOnce({ ok: true, actor: userActor, requestId: 'req-1' })
    const res = (await getAdminBranding(new Request('http://localhost/api/v1/admin/branding'))) as unknown as {
      status: number
      body: { error: { code: string } }
    }

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('returns current branding for admin on GET', async () => {
    mockRequire.mockResolvedValueOnce({ ok: true, actor: adminActor, requestId: 'req-1' })
    const res = (await getAdminBranding(new Request('http://localhost/api/v1/admin/branding'))) as unknown as {
      status: number
      body: { data: WorkspaceBranding }
    }

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(DEFAULT_BRANDING)
  })

  it('validates and updates branding on PUT', async () => {
    mockRequire.mockResolvedValueOnce({ ok: true, actor: adminActor, requestId: 'req-1' })
    const newBranding: WorkspaceBranding = {
      appName: 'Acme Timesheet',
      primaryColor: '#4F46E5',
      logoUrl: 'https://example.com/acme.png',
    }

    const res = (await putAdminBranding(
      new Request('http://localhost/api/v1/admin/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branding: newBranding }),
      })
    )) as unknown as { status: number; body: { data: WorkspaceBranding } }

    expect(res.status).toBe(200)
    expect(mockSetBranding).toHaveBeenCalledWith(adminActor, newBranding)
    expect(res.body.data).toEqual(newBranding)
  })

  it('rejects invalid branding with 400 VALIDATION_ERROR', async () => {
    mockRequire.mockResolvedValueOnce({ ok: true, actor: adminActor, requestId: 'req-1' })
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
    mockRequire.mockResolvedValueOnce({ ok: true, actor: adminActor, requestId: 'req-1' })
    const res = (await putAdminBranding(
      new Request('http://localhost/api/v1/admin/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      })
    )) as unknown as { status: number; body: { data: WorkspaceBranding } }

    expect(res.status).toBe(200)
    expect(mockSetBranding).toHaveBeenCalledWith(adminActor, DEFAULT_BRANDING)
    expect(res.body.data).toEqual(DEFAULT_BRANDING)
  })
})
