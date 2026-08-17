// tests/actions.test.ts
// Regression tests for the entry-flow server actions, in particular:
//   * logging a new entry must NOT silently replace an existing entry on the
//     same date (the previously reported bug)
//   * inactive accounts must not mutate entries
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getActor: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    getBackfillWindow: vi.fn(),
    findTimesheetByUserDate: vi.fn(),
    createTimesheet: vi.fn(),
    updateTimesheet: vi.fn(),
    getTimesheet: vi.fn(),
    sumHoursForUserDate: vi.fn(),
    getTimesheetDailyTotals: vi.fn(),
    resetTimesheets: vi.fn(),
    resetActivityData: vi.fn(),
    resetAllData: vi.fn(),
    deleteUser: vi.fn(),
    deleteActivityType: vi.fn(),
  },
}))

import { deleteUser, logEntry, logYesterday, resetDatabase, updateTimesheet } from '../app/actions'
import { getActor } from '@/lib/auth'
import { repo } from '@/lib/db'
import { addDaysISO, todayISO } from '../lib/dates'

const actor = { id: 'user-1', email: 'u@x.com', role: 'user' as const, isActive: true }
const input = {
  projectId: 'p1',
  activityTypeId: 'a1',
  hoursWorked: 8,
  workDone: 'did work',
  logDate: todayISO(),
}

const mockGetActor = vi.mocked(getActor)
const mockRepo = repo as unknown as {
  getBackfillWindow: ReturnType<typeof vi.fn>
  findTimesheetByUserDate: ReturnType<typeof vi.fn>
  createTimesheet: ReturnType<typeof vi.fn>
  updateTimesheet: ReturnType<typeof vi.fn>
  getTimesheet: ReturnType<typeof vi.fn>
  sumHoursForUserDate: ReturnType<typeof vi.fn>
  getTimesheetDailyTotals: ReturnType<typeof vi.fn>
  resetTimesheets: ReturnType<typeof vi.fn>
  resetActivityData: ReturnType<typeof vi.fn>
  resetAllData: ReturnType<typeof vi.fn>
  deleteUser: ReturnType<typeof vi.fn>
  deleteActivityType: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mockGetActor.mockResolvedValue(actor)
  mockRepo.getBackfillWindow.mockResolvedValue({ mode: 'days', windowDays: 1, extraDays: 0 })
  mockRepo.findTimesheetByUserDate.mockResolvedValue(null)
  mockRepo.createTimesheet.mockResolvedValue({ error: null })
  mockRepo.updateTimesheet.mockResolvedValue({ error: null })
  mockRepo.getTimesheet.mockResolvedValue(null)
  mockRepo.sumHoursForUserDate.mockResolvedValue(0)
  mockRepo.getTimesheetDailyTotals.mockResolvedValue([])
  mockRepo.resetTimesheets.mockResolvedValue({ error: null })
  mockRepo.resetActivityData.mockResolvedValue({ error: null })
  mockRepo.resetAllData.mockResolvedValue({ error: null })
  mockRepo.deleteUser.mockResolvedValue({ error: null })
  mockRepo.deleteActivityType.mockResolvedValue({ error: null })
})

describe('logEntry', () => {
  it('creates a new entry when none exists for the date', async () => {
    const result = await logEntry(input)
    expect(result).toEqual({})
    expect(mockRepo.createTimesheet).toHaveBeenCalledTimes(1)
  })

  it('allows a second entry for the same project, activity type and date within the 24h daily total', async () => {
    mockRepo.sumHoursForUserDate.mockResolvedValue(6)
    const result = await logEntry({ ...input, hoursWorked: 8 })
    expect(result).toEqual({})
    // The duplicate row is created as-is (same project + activity type + date),
    // not merged into or rejected against the existing entry.
    expect(mockRepo.createTimesheet).toHaveBeenCalledWith(actor, {
      userId: 'user-1',
      projectId: 'p1',
      activityTypeId: 'a1',
      hoursWorked: 8,
      workDone: 'did work',
      logDate: todayISO(),
    })
    expect(mockRepo.createTimesheet).toHaveBeenCalledTimes(1)
  })

  it('rejects when the daily total would exceed 24 hours', async () => {
    mockRepo.sumHoursForUserDate.mockResolvedValue(20)
    const result = await logEntry({ ...input, hoursWorked: 8 })
    expect(result.error).toContain('exceed 24 hours')
    expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
  })

  it('rejects entries from inactive accounts', async () => {
    mockGetActor.mockResolvedValue({ ...actor, isActive: false })
    const result = await logEntry(input)
    expect(result.error).toContain('not active')
    expect(mockRepo.sumHoursForUserDate).not.toHaveBeenCalled()
    expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
  })
})

describe('logYesterday', () => {
  const yesterdayInput = {
    projectId: 'p1',
    activityTypeId: 'a1',
    hoursWorked: 8,
    workDone: 'yesterday work',
  }

  it('allows multiple entries for yesterday within the 24h total', async () => {
    mockRepo.sumHoursForUserDate.mockResolvedValue(10)
    const result = await logYesterday(yesterdayInput)
    expect(result).toEqual({})
    expect(mockRepo.createTimesheet).toHaveBeenCalledWith(actor, {
      userId: 'user-1',
      projectId: 'p1',
      activityTypeId: 'a1',
      hoursWorked: 8,
      workDone: 'yesterday work',
      logDate: addDaysISO(todayISO(), -1),
    })
  })

  it('rejects when the yesterday total would exceed 24 hours', async () => {
    mockRepo.sumHoursForUserDate.mockResolvedValue(22)
    const result = await logYesterday(yesterdayInput)
    expect(result.error).toContain('exceed 24 hours')
    expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
  })
})

describe('updateTimesheet', () => {
  const target = {
    id: 'entry-1',
    user_id: 'user-1',
    project_id: 'p1',
    activity_type_id: 'a1',
    log_date: todayISO(),
    hours_worked: 4,
    work_done: 'old',
    created_at: 'x',
  }
  const editInput = {
    projectId: 'p1',
    activityTypeId: 'a1',
    hoursWorked: 8,
    workDone: 'edited',
    logDate: todayISO(),
  }

  it('allows edits that keep the day total within 24 hours', async () => {
    mockRepo.getTimesheet.mockResolvedValue(target)
    mockRepo.sumHoursForUserDate.mockResolvedValue(10) // others on that day
    const result = await updateTimesheet('entry-1', editInput)
    expect(result).toEqual({})
    expect(mockRepo.updateTimesheet).toHaveBeenCalledTimes(1)
  })

  it('rejects edits that push the day total above 24 hours', async () => {
    mockRepo.getTimesheet.mockResolvedValue(target)
    mockRepo.sumHoursForUserDate.mockResolvedValue(20) // others on that day
    const result = await updateTimesheet('entry-1', editInput)
    expect(result.error).toContain('exceed 24 hours')
    expect(mockRepo.updateTimesheet).not.toHaveBeenCalled()
  })
})

describe('super-admin gating', () => {
  const superAdmin = { id: 'a1', email: 'super@x.com', role: 'admin' as const, isActive: true }
  const otherAdmin = { id: 'a2', email: 'other@x.com', role: 'admin' as const, isActive: true }

  it('allows resetDatabase for the configured super-admin', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockGetActor.mockResolvedValue(superAdmin)
    const result = await resetDatabase('timesheets')
    expect(result).toEqual({})
    expect(mockRepo.resetTimesheets).toHaveBeenCalledTimes(1)
  })

  it('routes resetDatabase modes to the matching reset', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockGetActor.mockResolvedValue(superAdmin)
    await resetDatabase('activity')
    expect(mockRepo.resetActivityData).toHaveBeenCalledTimes(1)
    await resetDatabase('all')
    expect(mockRepo.resetAllData).toHaveBeenCalledTimes(1)
  })

  it('rejects resetDatabase for admins that are not the super-admin', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockGetActor.mockResolvedValue(otherAdmin)
    const result = await resetDatabase('timesheets')
    expect(result.error).toContain('permission')
    expect(mockRepo.resetTimesheets).not.toHaveBeenCalled()
  })

  it('rejects resetDatabase when SUPER_ADMIN_EMAIL is not configured', async () => {
    mockGetActor.mockResolvedValue(superAdmin)
    const result = await resetDatabase('timesheets')
    expect(result.error).toContain('permission')
  })

  it('rejects an invalid reset mode', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockGetActor.mockResolvedValue(superAdmin)
    const result = await resetDatabase('everything')
    expect(result.error).toContain('Invalid reset mode')
  })

  it('allows deleteUser for the super-admin but never for themselves', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockGetActor.mockResolvedValue(superAdmin)
    expect(await deleteUser('other-user')).toEqual({})
    expect(mockRepo.deleteUser).toHaveBeenCalledWith(superAdmin, 'other-user')

    const self = await deleteUser('a1')
    expect(self.error).toContain('own account')
    expect(mockRepo.deleteUser).toHaveBeenCalledTimes(1)
  })
})