import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequire,
  mockCreate,
  mockGet,
  mockSum,
  mockBackfill,
} = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockSum: vi.fn(),
  mockBackfill: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, init?: number | { status?: number }) => ({
    body,
    status: typeof init === 'number' ? init : (init?.status ?? 200),
  })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { error: { code, message } },
    status,
  })),
  serverError: vi.fn(() => ({ status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    createTimesheet: mockCreate,
    getTimesheet: mockGet,
    sumHoursForUserDate: mockSum,
    getBackfillWindow: mockBackfill,
  },
}))

import { POST } from '@/app/api/v1/timesheets/[id]/duplicate/route'
import { dailyWriteStore } from '@/lib/rate-limit'

const actor = { id: 'user-1', email: 'u@example.com', role: 'user', isActive: true }

beforeEach(() => {
  vi.clearAllMocks()
  dailyWriteStore.clear()
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
  mockBackfill.mockResolvedValue({ mode: 'days', windowDays: 30, extraDays: 0 })
  mockSum.mockResolvedValue(0)
  mockCreate.mockResolvedValue({ id: 'ts-dup-1', error: null })
  mockGet.mockImplementation((_, id: string) => {
    if (id === 'ts-1') {
      return Promise.resolve({
        id: 'ts-1',
        user_id: 'user-1',
        project_id: 'proj-1',
        activity_type_id: 'act-1',
        log_date: '2026-08-26',
        hours_worked: 7.5,
        work_done: 'Architecture review',
        projects: { name: 'Project Alpha' },
        activity_types: { name: 'Engineering' },
        profiles: { email: 'u@example.com' },
      })
    }
    if (id === 'ts-dup-1') {
      return Promise.resolve({
        id: 'ts-dup-1',
        user_id: 'user-1',
        project_id: 'proj-1',
        activity_type_id: 'act-1',
        log_date: '2026-08-26',
        hours_worked: 7.5,
        work_done: 'Architecture review',
        projects: { name: 'Project Alpha' },
        activity_types: { name: 'Engineering' },
        profiles: { email: 'u@example.com' },
      })
    }
    return Promise.resolve(null)
  })
})

describe('POST /api/v1/timesheets/[id]/duplicate', () => {
  it('duplicates own timesheet entry on valid POST and returns mapped DTO', async () => {
    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets/ts-1/duplicate', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'ts-1' }) }
    )) as unknown as {
      status: number
      body: { data: { success: boolean; entry: { id: string; project_id: string; hours_worked: number } } }
    }

    expect(response.status).toBe(201)
    expect(response.body.data.success).toBe(true)
    expect(response.body.data.entry.id).toBe('ts-dup-1')
    expect(response.body.data.entry.project_id).toBe('proj-1')
    expect(response.body.data.entry.hours_worked).toBe(7.5)
    expect(mockCreate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        userId: 'user-1',
        projectId: 'proj-1',
        activityTypeId: 'act-1',
        hoursWorked: 7.5,
        workDone: 'Architecture review',
        logDate: '2026-08-26',
      })
    )
  })

  it('allows overriding targetDate in request body', async () => {
    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets/ts-1/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDate: '2026-08-27' }),
      }),
      { params: Promise.resolve({ id: 'ts-1' }) }
    )) as unknown as { status: number }

    expect(response.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        logDate: '2026-08-27',
      })
    )
  })

  it('rejects duplicate if daily cap would exceed 24 hours', async () => {
    mockSum.mockResolvedValue(18) // 18 + 7.5 = 25.5 > 24

    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets/ts-1/duplicate', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'ts-1' }) }
    )) as unknown as { status: number; body: { error: { message: string } } }

    expect(response.status).toBe(400)
    expect(response.body.error.message).toMatch(/exceed 24 hours/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects duplicate if target entry belongs to another user and actor is not admin', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'ts-other',
      user_id: 'user-999',
      log_date: '2026-08-26',
      hours_worked: 4,
    })

    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets/ts-other/duplicate', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'ts-other' }) }
    )) as unknown as { status: number; body: { error: { code: string } } }

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
