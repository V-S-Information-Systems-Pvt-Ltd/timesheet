// tests/backup-restore-route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireActive, mockRestoreBackup, mockWriteAuditLog } = vi.hoisted(() => ({
  mockRequireActive: vi.fn(),
  mockRestoreBackup: vi.fn(),
  mockWriteAuditLog: vi.fn(),
}))

vi.mock('@/app/api/_http', () => ({
  json: vi.fn((body: unknown, status = 200, headers?: Record<string, string>) => ({ body, status, headers })),
  originCheck: vi.fn(() => null),
  requireActive: mockRequireActive,
  serverError: vi.fn((_err: unknown) => ({ error: 'internal' })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    restoreBackup: mockRestoreBackup,
    writeAuditLog: mockWriteAuditLog,
  },
}))

import { POST } from '../app/api/data/backup/restore/route'

interface ResShape {
  status: number
  body: {
    error?: string
    success?: boolean
    created?: Record<string, number>
    skipped?: number
  }
}

function rg(res: Response): ResShape {
  return res as unknown as ResShape
}

function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/data/backup/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  }) as Request
}

const adminActor = {
  id: 'admin-1',
  email: 'admin@vsis.lk',
  role: 'admin' as const,
  permission_role: 'admin' as const,
  hierarchy_role: 'manager' as const,
  isActive: true,
}

const userActor = {
  id: 'user-1',
  email: 'user@vsis.lk',
  role: 'user' as const,
  permission_role: 'user' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

describe('POST /api/data/backup/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireActive.mockResolvedValue({ ok: true, actor: adminActor })
    mockRestoreBackup.mockResolvedValue({
      created: { projects: 1, activityTypes: 1, timesheets: 1, leaves: 0, reminders: 0, globalReminders: 0 },
      skipped: 0,
      error: null,
    })
  })

  it('rejects unauthenticated requests', async () => {
    mockRequireActive.mockResolvedValue({
      ok: false,
      response: { body: { error: 'You must be signed in.' }, status: 401 },
    })
    const res = rg(await POST(req('{}')))
    expect(res.status).toBe(401)
  })

  it('rejects non-admin users with 403', async () => {
    mockRequireActive.mockResolvedValue({ ok: true, actor: userActor })
    const res = rg(await POST(req('{}')))
    expect(res.status).toBe(403)
  })

  it('rejects payload exceeding 20 MB with 413', async () => {
    const res = rg(await POST(req('{}', { 'content-length': String(25 * 1024 * 1024) })))
    expect(res.status).toBe(413)
    expect(res.body.error).toContain('too large')
  })

  it('rejects invalid JSON with 400', async () => {
    const res = rg(await POST(req('not valid json')))
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('not valid JSON')
  })

  it('restores valid backup successfully with 200', async () => {
    const validBackup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: [{ name: 'Project A' }],
      activityTypes: [{ name: 'Development' }],
      timesheets: [],
      leaves: [],
      reminders: [],
      globalReminders: [],
    })

    const res = rg(await POST(req(validBackup)))
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(mockRestoreBackup).toHaveBeenCalled()
    expect(mockWriteAuditLog).toHaveBeenCalledWith(adminActor, expect.objectContaining({ action: 'backup.restore' }))
  })
})
