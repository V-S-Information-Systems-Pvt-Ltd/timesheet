import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockRestore, mockOperationsDeps } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockRestore: vi.fn(),
  mockOperationsDeps: vi.fn(() => ({ persistence: {} })),
}))

const adminActor = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'admin' as const,
  permission_role: 'admin' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

vi.mock('@/app/api/v1/_http', () => ({
  withMobileActor: vi.fn(async (
    req: Request,
    handler: (auth: { actor: typeof adminActor; via: 'cookie' | 'bearer' }) => Promise<unknown>,
    options?: unknown
  ) => {
    const auth = (await mockRequire(req, options)) as {
      ok: boolean
      actor?: typeof adminActor
      via?: 'cookie' | 'bearer'
      response?: unknown
    }
    if (!auth.ok) return auth.response
    return handler({ actor: auth.actor!, via: auth.via ?? 'cookie' })
  }),
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  serverError: vi.fn(() => ({ body: { error: 'Internal server error.' }, status: 500 })),
}))

vi.mock('@/lib/db/operations', () => ({
  operationsDeps: mockOperationsDeps,
}))

vi.mock('@/lib/domain/operations', () => ({
  restoreBackupFromJson: mockRestore,
}))

import { POST } from '@/app/api/v1/admin/backup/restore/route'

const userActor = {
  ...adminActor,
  id: 'user-1',
  email: 'user@example.com',
  role: 'user' as const,
  permission_role: 'user' as const,
}

const created = {
  projects: 1,
  activityTypes: 2,
  timesheets: 3,
  leaves: 4,
  reminders: 5,
  globalReminders: 6,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequire.mockResolvedValue({ ok: true, actor: adminActor, via: 'cookie' })
  mockRestore.mockResolvedValue({
    ok: true,
    data: { created, skipped: 7, auditRecorded: true },
  })
})

describe('POST /api/v1/admin/backup/restore', () => {
  it('opts browser restore into cookie auth and preserves the legacy success shape', async () => {
    const request = new Request('http://localhost/api/v1/admin/backup/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    })

    const response = (await POST(request)) as unknown as {
      status: number
      body: { success: boolean; created: typeof created; skipped: number; auditRecorded: boolean }
    }

    expect(mockRequire).toHaveBeenCalledWith(request, { allowCookie: true })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true, created, skipped: 7, auditRecorded: true })
    expect(mockRestore).toHaveBeenCalledWith(
      adminActor,
      JSON.stringify({ version: 1 }),
      mockOperationsDeps.mock.results[0].value
    )
  })

  it('rejects a non-admin before restoring the payload', async () => {
    mockRequire.mockResolvedValueOnce({ ok: true, actor: userActor, via: 'cookie' })
    const request = new Request('http://localhost/api/v1/admin/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ version: 1 }),
    })

    const response = (await POST(request)) as unknown as { status: number; body: { error: string } }

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('permission')
    expect(mockRestore).not.toHaveBeenCalled()
  })

  it('rejects an oversized declared body before restoring it', async () => {
    const request = new Request('http://localhost/api/v1/admin/backup/restore', {
      method: 'POST',
      headers: { 'content-length': String(20 * 1024 * 1024 + 1) },
      body: '{}',
    })

    const response = (await POST(request)) as unknown as { status: number; body: { error: string } }

    expect(response.status).toBe(413)
    expect(response.body.error).toContain('20 MB')
    expect(mockRestore).not.toHaveBeenCalled()
  })

  it('preserves committed-restore audit failure reporting', async () => {
    mockRestore.mockResolvedValueOnce({
      ok: true,
      data: { created, skipped: 0, auditRecorded: false },
    })
    const request = new Request('http://localhost/api/v1/admin/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ version: 1 }),
    })

    const response = (await POST(request)) as unknown as {
      status: number
      body: { success: boolean; auditRecorded: boolean; auditError?: string }
    }

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.auditRecorded).toBe(false)
    expect(response.body.auditError).toContain('audit record could not be written')
  })

  it('maps restore validation/storage failures without fabricating success counts', async () => {
    mockRestore.mockResolvedValueOnce({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid backup file.' },
    })
    const request = new Request('http://localhost/api/v1/admin/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ invalid: true }),
    })

    const response = (await POST(request)) as unknown as { status: number; body: { error: string; created?: unknown } }

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'Invalid backup file.' })
    expect(response.body.created).toBeUndefined()
  })
})
