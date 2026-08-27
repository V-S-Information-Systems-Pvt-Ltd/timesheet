import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireMobileActor, mockListDueGlobalReminders, mockDismissGlobalReminder } = vi.hoisted(() => ({
  mockRequireMobileActor: vi.fn(),
  mockListDueGlobalReminders: vi.fn(),
  mockDismissGlobalReminder: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequireMobileActor,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  apiError: vi.fn((code: string, message: string, status = 400) => ({ body: { data: null, error: { code, message } }, status })),
  serverError: vi.fn((_err: unknown) => ({ body: { data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    listDueGlobalReminders: mockListDueGlobalReminders,
    dismissGlobalReminder: mockDismissGlobalReminder,
  },
}))

import { GET } from '@/app/api/v1/reminders/global/route'
import { POST as dismissPOST } from '@/app/api/v1/reminders/global/[id]/dismiss/route'

describe('Global Reminders v1 Routes', () => {
  const actor = { id: 'u1', email: 'emp@example.com', role: 'user', isActive: true }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET /api/v1/reminders/global returns due global reminders', async () => {
    mockRequireMobileActor.mockResolvedValue({ ok: true, actor })
    mockListDueGlobalReminders.mockResolvedValue([
      { id: 'gr-1', message: 'Submit monthly report', remind_at: '2026-08-28T09:00:00Z', created_at: '2026-08-01T00:00:00Z' },
    ])

    const res = (await GET(new Request('http://localhost/api/v1/reminders/global'))) as unknown as {
      status: number
      body: { data: unknown[]; error: null }
    }

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toMatchObject({ id: 'gr-1', message: 'Submit monthly report' })
  })

  it('POST /api/v1/reminders/global/[id]/dismiss dismisses global reminder', async () => {
    mockRequireMobileActor.mockResolvedValue({ ok: true, actor })
    mockDismissGlobalReminder.mockResolvedValue({ error: null })

    const res = (await dismissPOST(
      new Request('http://localhost/api/v1/reminders/global/gr-1/dismiss', { method: 'POST' }),
      { params: Promise.resolve({ id: 'gr-1' }) }
    )) as unknown as { status: number; body: { data: { success: boolean }; error: null } }

    expect(res.status).toBe(200)
    expect(res.body.data.success).toBe(true)
    expect(mockDismissGlobalReminder).toHaveBeenCalledWith(actor, 'gr-1')
  })
})
