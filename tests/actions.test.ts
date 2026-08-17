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
    resetTimesheets: vi.fn(),
    resetActivityData: vi.fn(),
    resetAllData: vi.fn(),
    deleteUser: vi.fn(),
    deleteActivityType: vi.fn(),
  },
}))

import { deleteUser, logEntry, resetDatabase } from '../app/actions'
import { getActor } from '@/lib/auth'
import { repo } from '@/lib/db'
import { todayISO } from '../lib/dates'

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

  it('does NOT replace an existing entry on the same date', async () => {
    mockRepo.findTimesheetByUserDate.mockResolvedValue({
      id: 'old-1',
      user_id: 'user-1',
      project_id: 'p1',
      activity_type_id: 'a1',
      log_date: input.logDate,
      hours_worked: 8,
      work_done: 'x',
      created_at: 'x',
    })
    const result = await logEntry(input)
    expect(result.error).toContain('already exists')
    expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
    expect(mockRepo.updateTimesheet).not.toHaveBeenCalled()
  })

  it('rejects entries from inactive accounts', async () => {
    mockGetActor.mockResolvedValue({ ...actor, isActive: false })
    const result = await logEntry(input)
    expect(result.error).toContain('not active')
    expect(mockRepo.findTimesheetByUserDate).not.toHaveBeenCalled()
    expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
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