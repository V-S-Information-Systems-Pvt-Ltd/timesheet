import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequire,
  mockGetBackfillWindow,
  mockSetBackfillWindow,
  mockListLeaves,
  mockCreateLeaves,
  mockDeleteLeave,
  mockListGlobalReminders,
  mockCreateGlobalReminder,
  mockDeleteGlobalReminder,
  mockCreateTimesheet,
  mockSumHoursForUserDate,
} = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockGetBackfillWindow: vi.fn(),
  mockSetBackfillWindow: vi.fn(),
  mockListLeaves: vi.fn(),
  mockCreateLeaves: vi.fn(),
  mockDeleteLeave: vi.fn(),
  mockListGlobalReminders: vi.fn(),
  mockCreateGlobalReminder: vi.fn(),
  mockDeleteGlobalReminder: vi.fn(),
  mockCreateTimesheet: vi.fn(),
  mockSumHoursForUserDate: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, init?: number | { status?: number }) => {
    const status = typeof init === 'number' ? init : init?.status ?? 200
    return { body, status }
  }),
  badRequest: vi.fn((message: string) => ({ body: { error: { code: 'BAD_REQUEST', message } }, status: 400 })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { error: { code, message } },
    status,
  })),
  serverError: vi.fn((err: unknown) => ({ body: { error: err }, status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    getBackfillWindow: mockGetBackfillWindow,
    setBackfillWindow: mockSetBackfillWindow,
    listLeaves: mockListLeaves,
    createLeaves: mockCreateLeaves,
    deleteLeave: mockDeleteLeave,
    listGlobalReminders: mockListGlobalReminders,
    createGlobalReminder: mockCreateGlobalReminder,
    deleteGlobalReminder: mockDeleteGlobalReminder,
    createTimesheet: mockCreateTimesheet,
    sumHoursForUserDate: mockSumHoursForUserDate,
  },
}))

import { GET as getBackfill, PUT as putBackfill } from '@/app/api/v1/admin/settings/backfill/route'
import { GET as getAdminLeaves, POST as postAdminLeaves } from '@/app/api/v1/admin/leaves/route'
import { DELETE as deleteAdminLeaveRoute } from '@/app/api/v1/admin/leaves/[id]/route'
import { GET as getAdminReminders, POST as postAdminReminders } from '@/app/api/v1/admin/global-reminders/route'
import { DELETE as deleteAdminReminderRoute } from '@/app/api/v1/admin/global-reminders/[id]/route'
import { POST as postTimesheet } from '@/app/api/v1/timesheets/route'

describe('Slice 11: Mobile Operational Administration Routes', () => {
  const adminActor = {
    id: 'u-admin',
    email: 'admin@vsis.lk',
    role: 'admin' as const,
    permission_role: 'admin' as const,
    hierarchy_role: 'manager' as const,
    isActive: true,
  }

  const managerActor = {
    id: 'u-manager',
    email: 'manager@vsis.lk',
    role: 'user' as const,
    permission_role: 'user' as const,
    hierarchy_role: 'manager' as const,
    isActive: true,
  }

  const userActor = {
    id: 'u-user',
    email: 'user@vsis.lk',
    role: 'user' as const,
    permission_role: 'user' as const,
    hierarchy_role: 'engineer' as const,
    isActive: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockRequire.mockResolvedValue({ ok: true, actor: adminActor })
    mockGetBackfillWindow.mockResolvedValue({ mode: 'days', windowDays: 7, extraDays: 0 })
    mockSumHoursForUserDate.mockResolvedValue(0)
    mockCreateTimesheet.mockResolvedValue({ error: null })
  })

interface MockResponse<T = Record<string, unknown>> {
  status: number
  body: {
    data?: T
    error?: { code?: string; message?: string } | null
  }
}

  describe('/api/v1/admin/settings/backfill', () => {
    it('authorizes admin to get and update backfill settings, rejects non-admin with 403', async () => {
      const resGet = (await getBackfill(new Request('http://localhost/api/v1/admin/settings/backfill'))) as unknown as MockResponse<{ mode: string }>
      expect(resGet.status).toBe(200)
      expect(resGet.body.data?.mode).toBe('days')

      mockRequire.mockResolvedValueOnce({ ok: true, actor: userActor })
      const resNonAdmin = (await getBackfill(new Request('http://localhost/api/v1/admin/settings/backfill'))) as unknown as MockResponse
      expect(resNonAdmin.status).toBe(403)

      mockSetBackfillWindow.mockResolvedValueOnce({ error: null })
      const reqPut = new Request('http://localhost/api/v1/admin/settings/backfill', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'month_start', windowDays: 0, extraDays: 3 }),
      })
      const resPut = (await putBackfill(reqPut)) as unknown as MockResponse
      expect(resPut.status).toBe(200)
      expect(mockSetBackfillWindow).toHaveBeenCalledWith(adminActor, {
        mode: 'month_start',
        windowDays: 0,
        extraDays: 3,
      })
    })

    it('validates window boundaries', async () => {
      const reqBad = new Request('http://localhost/api/v1/admin/settings/backfill', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'invalid_mode', windowDays: 999, extraDays: -1 }),
      })
      const resBad = (await putBackfill(reqBad)) as unknown as MockResponse
      expect(resBad.status).toBe(400)
    })
  })

  describe('/api/v1/admin/leaves', () => {
    it('permits managers and admins to list and create team leaves, rejects regular users with 403', async () => {
      mockListLeaves.mockResolvedValueOnce([
        { id: 'l1', user_id: 'u-user', leave_date: '2026-09-01', reason: 'Medical' },
      ])

      const resList = (await getAdminLeaves(new Request('http://localhost/api/v1/admin/leaves?userId=u-user'))) as unknown as MockResponse<Array<{ id: string }>>
      expect(resList.status).toBe(200)
      expect(resList.body.data).toHaveLength(1)

      mockRequire.mockResolvedValueOnce({ ok: true, actor: userActor })
      const resUserForbidden = (await getAdminLeaves(new Request('http://localhost/api/v1/admin/leaves'))) as unknown as MockResponse
      expect(resUserForbidden.status).toBe(403)

      mockRequire.mockResolvedValueOnce({ ok: true, actor: managerActor })
      mockCreateLeaves.mockResolvedValueOnce({ error: null })
      const reqPost = new Request('http://localhost/api/v1/admin/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: [{ userId: 'u-user', leaveDate: '2026-09-02', reason: 'Annual Leave' }],
        }),
      })
      const resPost = (await postAdminLeaves(reqPost)) as unknown as MockResponse
      expect(resPost.status).toBe(201)
      expect(mockCreateLeaves).toHaveBeenCalledWith(managerActor, [
        { userId: 'u-user', leaveDate: '2026-09-02', reason: 'Annual Leave' },
      ])
    })

    it('deletes leave markers via /api/v1/admin/leaves/[id]', async () => {
      mockDeleteLeave.mockResolvedValueOnce({ error: null })
      const resDel = (await deleteAdminLeaveRoute(new Request('http://localhost/api/v1/admin/leaves/l1', { method: 'DELETE' }), {
        params: Promise.resolve({ id: 'l1' }),
      })) as unknown as MockResponse
      expect(resDel.status).toBe(200)
      expect(mockDeleteLeave).toHaveBeenCalledWith(adminActor, 'l1')
    })
  })

  describe('/api/v1/admin/global-reminders', () => {
    it('authorizes admin to broadcast and delete global reminders', async () => {
      mockListGlobalReminders.mockResolvedValue([
        { id: 'rem-1', message: 'Submit timesheets', remind_at: '2026-09-01T17:00:00.000Z' },
      ])

      const resList = (await getAdminReminders(new Request('http://localhost/api/v1/admin/global-reminders'))) as unknown as MockResponse<Array<{ id: string }>>
      expect(resList.status).toBe(200)
      expect(resList.body.data).toHaveLength(1)

      mockCreateGlobalReminder.mockResolvedValueOnce({ error: null })
      const reqCreate = new Request('http://localhost/api/v1/admin/global-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Company Townhall at 4 PM', remindAt: '2026-09-01T16:00:00.000Z' }),
      })
      const resCreate = (await postAdminReminders(reqCreate)) as unknown as MockResponse
      expect(resCreate.status).toBe(201)
      expect(mockCreateGlobalReminder).toHaveBeenCalledWith(adminActor, {
        message: 'Company Townhall at 4 PM',
        remindAt: expect.any(String),
      })

      mockDeleteGlobalReminder.mockResolvedValueOnce({ error: null })
      const resDel = (await deleteAdminReminderRoute(new Request('http://localhost/api/v1/admin/global-reminders/rem-1', { method: 'DELETE' }), {
        params: Promise.resolve({ id: 'rem-1' }),
      })) as unknown as MockResponse
      expect(resDel.status).toBe(200)
      expect(mockDeleteGlobalReminder).toHaveBeenCalledWith(adminActor, 'rem-1')
    })
  })

  describe('Admin Backfill / Time logging for another user via /api/v1/timesheets', () => {
    it('permits admin to log timesheet for another user and bypasses backfill window', async () => {
      mockSumHoursForUserDate.mockResolvedValueOnce(4) // 4h already logged
      const req = new Request('http://localhost/api/v1/timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'u-user',
          projectId: 'p-1',
          activityTypeId: 'a-1',
          hoursWorked: 6,
          workDone: 'Admin backfill for sick day',
          logDate: '2026-01-01', // old date
        }),
      })

      const res = (await postTimesheet(req)) as unknown as MockResponse
      expect(res.status).toBe(201)
      expect(mockCreateTimesheet).toHaveBeenCalledWith(
        adminActor,
        expect.objectContaining({
          userId: 'u-user',
          projectId: 'p-1',
          activityTypeId: 'a-1',
          hoursWorked: 6,
          workDone: 'Admin backfill for sick day',
          logDate: '2026-01-01',
        })
      )
    })

    it('rejects regular users attempting to log time for someone else with 403', async () => {
      mockRequire.mockResolvedValueOnce({ ok: true, actor: userActor })
      const req = new Request('http://localhost/api/v1/timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'u-admin',
          projectId: 'p-1',
          activityTypeId: 'a-1',
          hoursWorked: 8,
          workDone: 'Unauthorized attempt',
          logDate: '2026-08-31',
        }),
      })

      const res = (await postTimesheet(req)) as unknown as MockResponse
      expect(res.status).toBe(403)
      expect(res.body.error?.message).toContain('Only admins can log time for other users')
    })
  })
})
