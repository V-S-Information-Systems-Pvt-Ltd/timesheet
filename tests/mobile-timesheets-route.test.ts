import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequire,
  mockList,
  mockCreate,
  mockGet,
  mockUpdate,
  mockDelete,
  mockSum,
  mockBackfill,
} = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockSum: vi.fn(),
  mockBackfill: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { error: { code, message } },
    status,
  })),
  serverError: vi.fn(() => ({ status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    listTimesheets: mockList,
    createTimesheet: mockCreate,
    getTimesheet: mockGet,
    updateTimesheet: mockUpdate,
    deleteTimesheet: mockDelete,
    sumHoursForUserDate: mockSum,
    getBackfillWindow: mockBackfill,
  },
}))

import { GET, POST } from '@/app/api/v1/timesheets/route'
import { PUT, DELETE } from '@/app/api/v1/timesheets/[id]/route'

const actor = { id: 'user-1', email: 'u@example.com', role: 'user', isActive: true }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
  mockList.mockResolvedValue({ rows: [], count: 0 })
  mockBackfill.mockResolvedValue({ mode: 'days', windowDays: 30, extraDays: 0 })
  mockSum.mockResolvedValue(0)
  mockCreate.mockResolvedValue({ error: null })
  mockUpdate.mockResolvedValue({ error: null })
  mockDelete.mockResolvedValue({ error: null })
})

describe('/api/v1/timesheets', () => {
  it('passes validated filters to the repository on GET', async () => {
    const response = (await GET(
      new Request('http://localhost/api/v1/timesheets?dateFrom=2026-08-01&limit=10')
    )) as unknown as { status: number; body: { data: unknown } }
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ rows: [], count: 0 })
    expect(mockList).toHaveBeenCalledWith(actor, { dateFrom: '2026-08-01', limit: 10 })
  })

  it('creates timesheet entry on valid POST', async () => {
    const body = {
      projectId: 'proj-1',
      activityTypeId: 'act-1',
      hoursWorked: 7.5,
      workDone: 'Implemented feature',
      logDate: '2026-08-26',
    }
    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )) as unknown as { status: number; body: { data: { success: boolean } } }

    expect(response.status).toBe(201)
    expect(response.body.data).toEqual({ success: true })
    expect(mockCreate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        projectId: 'proj-1',
        hoursWorked: 7.5,
        logDate: '2026-08-26',
      })
    )
  })

  it('rejects POST exceeding 24 hours daily total', async () => {
    mockSum.mockResolvedValue(20)
    const body = {
      projectId: 'proj-1',
      activityTypeId: 'act-1',
      hoursWorked: 5,
      workDone: 'Overtime work',
      logDate: '2026-08-26',
    }
    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )) as unknown as { status: number; body: { error: { message: string } } }

    expect(response.status).toBe(400)
    expect(response.body.error.message).toMatch(/exceed 24 hours/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('updates entry on valid PUT', async () => {
    mockGet.mockResolvedValue({
      id: 'ts-1',
      user_id: 'user-1',
      log_date: '2026-08-26',
      hours_worked: 4,
    })
    const body = {
      projectId: 'proj-2',
      activityTypeId: 'act-2',
      hoursWorked: 6,
      workDone: 'Updated work description',
      logDate: '2026-08-26',
    }
    const response = (await PUT(
      new Request('http://localhost/api/v1/timesheets/ts-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: 'ts-1' }) }
    )) as unknown as { status: number; body: { data: { success: boolean } } }

    expect(response.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      actor,
      'ts-1',
      expect.objectContaining({ projectId: 'proj-2', hoursWorked: 6 })
    )
  })

  it('deletes own entry on DELETE', async () => {
    mockGet.mockResolvedValue({
      id: 'ts-1',
      user_id: 'user-1',
      log_date: '2026-08-26',
    })
    const response = (await DELETE(new Request('http://localhost/api/v1/timesheets/ts-1'), {
      params: Promise.resolve({ id: 'ts-1' }),
    })) as unknown as { status: number }

    expect(response.status).toBe(200)
    expect(mockDelete).toHaveBeenCalledWith(actor, 'ts-1')
  })
})
