import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    listTimesheets: vi.fn(),
    getBackfillWindow: vi.fn(),
    getTimesheet: vi.fn(),
    getTimesheetsByIds: vi.fn(),
    getLatestTimesheet: vi.fn(),
    sumHoursForUserDate: vi.fn(),
    sumHoursForUserDates: vi.fn(),
    createTimesheet: vi.fn(),
    updateTimesheet: vi.fn(),
    deleteTimesheet: vi.fn(),
    bulkUpdateTimesheets: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ repo: mockRepo }))

// The daily budget always rejects: every mutating service must surface the
// domain's RATE_LIMITED error as a 429 without touching persistence.
vi.mock('@/lib/rate-limit', () => ({
  reserveWriteRateLimit: vi.fn(async () => ({
    ok: false,
    error: 'Rate limit exceeded. Try again later.',
    retryAfter: 60,
  })),
}))

import {
  createTimesheetService,
  updateTimesheetService,
  deleteTimesheetService,
  duplicateTimesheetService,
  batchDeleteTimesheetsService,
  batchDuplicateTimesheetsService,
  listTimesheetsService,
} from '@/lib/api/v1/services/timesheets'
import type { Actor } from '@/lib/db/repository'

const actor: Actor = {
  id: 'user-1',
  email: 'u@example.com',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'engineer',
  isActive: true,
}

const input = {
  projectId: 'p1',
  activityTypeId: 'a1',
  hoursWorked: 4,
  workDone: 'Work',
  logDate: '2026-09-12',
}

describe('v1 timesheet services map an exhausted write budget to RATE_LIMITED', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects create with 429 and never writes', async () => {
    const result = await createTimesheetService(actor, input)
    expect(result).toEqual({
      success: false,
      code: 'RATE_LIMITED',
      message: expect.stringMatching(/rate limit/i),
      status: 429,
    })
    expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
  })

  it('rejects update with 429 and never writes', async () => {
    const result = await updateTimesheetService(actor, 'ts-1', input)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.status).toBe(429)
    expect(mockRepo.updateTimesheet).not.toHaveBeenCalled()
  })

  it('rejects delete with 429 and never writes', async () => {
    const result = await deleteTimesheetService(actor, 'ts-1')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.status).toBe(429)
    expect(mockRepo.deleteTimesheet).not.toHaveBeenCalled()
  })

  it('rejects duplicate with 429 and never writes', async () => {
    const result = await duplicateTimesheetService(actor, 'ts-1')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.status).toBe(429)
    expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
  })

  it('rejects batch delete with 429 and never writes', async () => {
    const result = await batchDeleteTimesheetsService(actor, ['ts-1', 'ts-2'])
    expect(result.success).toBe(false)
    if (!result.success) expect(result.status).toBe(429)
    expect(mockRepo.deleteTimesheet).not.toHaveBeenCalled()
  })

  it('rejects batch duplicate with 429 and never writes', async () => {
    const result = await batchDuplicateTimesheetsService(actor, [{ id: 'ts-1' }])
    expect(result.success).toBe(false)
    if (!result.success) expect(result.status).toBe(429)
    expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
  })

  it('leaves reads unbudgeted', async () => {
    mockRepo.listTimesheets.mockResolvedValue({ rows: [], count: 0 })
    const result = await listTimesheetsService(actor, {})
    expect(result).toEqual({ success: true, data: { rows: [], count: 0 } })
  })
})
