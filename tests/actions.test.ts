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
    getTimesheetsByIds: vi.fn(),
    sumHoursForUserDate: vi.fn(),
    sumHoursForUserDates: vi.fn(),
    getTimesheetDailyTotals: vi.fn(),
    bulkUpdateTimesheets: vi.fn(),
    listProfiles: vi.fn(),
    updateUserManager: vi.fn(),
    setAdminLayout: vi.fn(),
    getDefaultLayouts: vi.fn(),
    setDefaultLayouts: vi.fn(),
    exportBackup: vi.fn(),
    restoreBackup: vi.fn(),
    resetTimesheets: vi.fn(),
    resetActivityData: vi.fn(),
    resetAllData: vi.fn(),
    deleteUser: vi.fn(),
    deleteActivityType: vi.fn(),
    writeAuditLog: vi.fn(),
  },
}))

import { deleteUser, bulkUpdateTimesheets, duplicateEntry, exportBackup, getDefaultLayouts, logEntry, logYesterday, resetDatabase, restoreBackup, saveAdminLayout, setDefaultLayouts, setUserManager, updateTimesheet } from '../app/actions'
import { getActor } from '@/lib/auth'
import { repo } from '@/lib/db'
import { dailyWriteStore } from '@/lib/rate-limit'
import { addDaysISO, todayISO } from '../lib/dates'
import { ADMIN_TILE_IDS, TILE_IDS } from '../app/constants'
import type { DashboardLayout } from '../app/types'

const actor = { id: 'user-1', email: 'u@x.com', role: 'user' as const, permission_role: 'user' as const, hierarchy_role: 'user' as const, isActive: true }
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
  getTimesheetsByIds: ReturnType<typeof vi.fn>
  sumHoursForUserDate: ReturnType<typeof vi.fn>
  sumHoursForUserDates: ReturnType<typeof vi.fn>
  getTimesheetDailyTotals: ReturnType<typeof vi.fn>
  bulkUpdateTimesheets: ReturnType<typeof vi.fn>
  listProfiles: ReturnType<typeof vi.fn>
  updateUserManager: ReturnType<typeof vi.fn>
  setAdminLayout: ReturnType<typeof vi.fn>
  getDefaultLayouts: ReturnType<typeof vi.fn>
  setDefaultLayouts: ReturnType<typeof vi.fn>
  exportBackup: ReturnType<typeof vi.fn>
  restoreBackup: ReturnType<typeof vi.fn>
  resetTimesheets: ReturnType<typeof vi.fn>
  resetActivityData: ReturnType<typeof vi.fn>
  resetAllData: ReturnType<typeof vi.fn>
  deleteUser: ReturnType<typeof vi.fn>
  deleteActivityType: ReturnType<typeof vi.fn>
  writeAuditLog: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mockGetActor.mockResolvedValue(actor)
  mockRepo.writeAuditLog.mockResolvedValue({ error: null })
  mockRepo.getBackfillWindow.mockResolvedValue({ mode: 'days', windowDays: 1, extraDays: 0 })
  mockRepo.findTimesheetByUserDate.mockResolvedValue(null)
  mockRepo.createTimesheet.mockResolvedValue({ error: null })
  mockRepo.updateTimesheet.mockResolvedValue({ error: null })
  mockRepo.getTimesheet.mockResolvedValue(null)
  mockRepo.sumHoursForUserDate.mockResolvedValue(0)
  mockRepo.getTimesheetDailyTotals.mockResolvedValue([])
  mockRepo.bulkUpdateTimesheets.mockResolvedValue({ updated: 0, rowErrors: [], error: null })
  mockRepo.listProfiles.mockResolvedValue([])
  mockRepo.updateUserManager.mockResolvedValue({ error: null })
  mockRepo.setAdminLayout.mockResolvedValue({ error: null })
  mockRepo.exportBackup.mockResolvedValue({ payload: null, error: null })
  mockRepo.restoreBackup.mockResolvedValue({
    created: { projects: 0, activityTypes: 0, timesheets: 0, leaves: 0, reminders: 0, globalReminders: 0 },
    skipped: 0,
    error: null,
  })
  mockRepo.resetTimesheets.mockResolvedValue({ error: null })
  mockRepo.resetActivityData.mockResolvedValue({ error: null })
  mockRepo.resetAllData.mockResolvedValue({ error: null })
  mockRepo.deleteUser.mockResolvedValue({ error: null })
  mockRepo.deleteActivityType.mockResolvedValue({ error: null })
  dailyWriteStore.clear()
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

describe('duplicateEntry', () => {
  const ownTarget = {
    id: 'entry-1',
    user_id: 'user-1',
    project_id: 'p1',
    activity_type_id: 'a1',
    log_date: todayISO(),
    hours_worked: 4,
    work_done: 'old',
    created_at: 'x',
  }

  it('duplicates an own entry, copying all fields for the same user', async () => {
    mockRepo.getTimesheet.mockResolvedValue(ownTarget)
    mockRepo.sumHoursForUserDate.mockResolvedValue(10) // day total includes the original 4h
    const result = await duplicateEntry('entry-1')
    expect(result).toEqual({})
    expect(mockRepo.createTimesheet).toHaveBeenCalledWith(actor, {
      userId: 'user-1',
      projectId: 'p1',
      activityTypeId: 'a1',
      hoursWorked: 4,
      workDone: 'old',
      logDate: todayISO(),
    })
    expect(mockRepo.createTimesheet).toHaveBeenCalledTimes(1)
  })

  it('blocks a regular user from duplicating another user\'s entry', async () => {
    mockRepo.getTimesheet.mockResolvedValue({ ...ownTarget, user_id: 'other-id' })
    const result = await duplicateEntry('entry-1')
    expect(result.error).toContain('own')
    expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
  })

  it('rejects when the day total would exceed 24 hours', async () => {
    mockRepo.getTimesheet.mockResolvedValue(ownTarget)
    mockRepo.sumHoursForUserDate.mockResolvedValue(22)
    const result = await duplicateEntry('entry-1')
    expect(result.error).toContain('exceed 24 hours')
    expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
  })

  it('rejects when the entry date is outside the backfill window', async () => {
    mockRepo.getTimesheet.mockResolvedValue({
      ...ownTarget,
      log_date: addDaysISO(todayISO(), -5),
    })
    const result = await duplicateEntry('entry-1')
    expect(result.error).toContain('outside the writable backfill window')
    expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
  })

  it('lets an admin duplicate another user\'s entry without window checks', async () => {
    const admin = { id: 'admin-1', email: 'admin@x.com', role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'user' as const, isActive: true }
    mockGetActor.mockResolvedValue(admin)
    mockRepo.getTimesheet.mockResolvedValue({
      ...ownTarget,
      user_id: 'other-id',
      log_date: addDaysISO(todayISO(), -5),
    })
    mockRepo.sumHoursForUserDate.mockResolvedValue(0)
    const result = await duplicateEntry('entry-1')
    expect(result).toEqual({})
    expect(mockRepo.createTimesheet).toHaveBeenCalledWith(admin, {
      userId: 'other-id',
      projectId: 'p1',
      activityTypeId: 'a1',
      hoursWorked: 4,
      workDone: 'old',
      logDate: addDaysISO(todayISO(), -5),
    })
  })
})

describe('setUserManager', () => {
  const adminActor = { id: 'a1', email: 'admin@x.com', role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'user' as const, isActive: true }

  it('blocks non-admins', async () => {
    const result = await setUserManager('u2', 'm1')
    expect(result.error).toContain('permission')
    expect(mockRepo.updateUserManager).not.toHaveBeenCalled()
  })

  it('lets an admin assign a manager', async () => {
    mockGetActor.mockResolvedValue(adminActor)
    mockRepo.listProfiles.mockResolvedValue([
      { id: 'm1', email: 'm@x.com', manager_id: null },
    ])
    const result = await setUserManager('u2', 'm1')
    expect(result).toEqual({})
    expect(mockRepo.updateUserManager).toHaveBeenCalledWith(adminActor, 'u2', 'm1')
  })

  it('lets an admin clear the reporting line', async () => {
    mockGetActor.mockResolvedValue(adminActor)
    const result = await setUserManager('u2', null)
    expect(result).toEqual({})
    expect(mockRepo.updateUserManager).toHaveBeenCalledWith(adminActor, 'u2', null)
  })

  it('blocks changing your own reporting line', async () => {
    mockGetActor.mockResolvedValue(adminActor)
    const result = await setUserManager('a1', 'm1')
    expect(result.error).toContain('own reporting line')
    expect(mockRepo.updateUserManager).not.toHaveBeenCalled()
  })

  it('blocks self-assignment as manager', async () => {
    mockGetActor.mockResolvedValue(adminActor)
    const result = await setUserManager('u2', 'u2')
    expect(result.error).toContain('report to themselves')
    expect(mockRepo.updateUserManager).not.toHaveBeenCalled()
  })

  it('blocks reporting cycles', async () => {
    mockGetActor.mockResolvedValue(adminActor)
    // A reports to B, and B reports to A -> assigning A -> B would loop.
    mockRepo.listProfiles.mockResolvedValue([
      { id: 'A', email: 'a@x.com', manager_id: 'B' },
      { id: 'B', email: 'b@x.com', manager_id: 'A' },
    ])
    const result = await setUserManager('A', 'B')
    expect(result.error).toContain('reporting cycle')
    expect(mockRepo.updateUserManager).not.toHaveBeenCalled()
  })
})

describe('backup & restore', () => {
  const adminActor = { id: 'a1', email: 'admin@x.com', role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'user' as const, isActive: true }
  const validPayload = {
    version: 1,
    exportedAt: '2026-08-20T00:00:00.000Z',
    projects: [{ name: 'Alpha', so_number: null, telegram_no: null }],
    activityTypes: [{ name: 'R&D', is_active: true, telegram_no: 5 }],
    timesheets: [],
    leaves: [],
    reminders: [],
    globalReminders: [],
  }

  it('blocks non-admins from exporting', async () => {
    const result = await exportBackup()
    expect(result.payload).toBeNull()
    expect(result.error).toContain('permission')
    expect(mockRepo.exportBackup).not.toHaveBeenCalled()
  })

  it('lets an admin export a payload', async () => {
    mockGetActor.mockResolvedValue(adminActor)
    mockRepo.exportBackup.mockResolvedValue({ payload: validPayload, error: null })
    const result = await exportBackup()
    expect(result.payload).toEqual(validPayload)
  })

  it('blocks non-admins from restoring', async () => {
    const result = await restoreBackup(JSON.stringify(validPayload))
    expect(result.error).toContain('permission')
    expect(mockRepo.restoreBackup).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON', async () => {
    mockGetActor.mockResolvedValue(adminActor)
    const result = await restoreBackup('{not json')
    expect(result.error).toContain('Invalid backup file')
    expect(mockRepo.restoreBackup).not.toHaveBeenCalled()
  })

  it('rejects unsupported versions', async () => {
    mockGetActor.mockResolvedValue(adminActor)
    const result = await restoreBackup(JSON.stringify({ ...validPayload, version: 99 }))
    expect(result.error).toContain('Unsupported backup version')
    expect(mockRepo.restoreBackup).not.toHaveBeenCalled()
  })

  it('passes a validated payload to the repository and surfaces created counts', async () => {
    mockGetActor.mockResolvedValue(adminActor)
    mockRepo.restoreBackup.mockResolvedValue({
      created: { projects: 1, activityTypes: 1, timesheets: 3, leaves: 0, reminders: 0, globalReminders: 0 },
      skipped: 2,
      error: null,
    })
    const result = await restoreBackup(JSON.stringify(validPayload))
    expect(result.error).toBeUndefined()
    expect(mockRepo.restoreBackup).toHaveBeenCalledTimes(1)
    expect(result.created?.timesheets).toBe(3)
    expect(result.skipped).toBe(2)
  })
})

describe('saveAdminLayout', () => {
  const regularAdmin = { id: 'a1', email: 'admin@x.com', role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'user' as const, isActive: true }
  const superAdminActor = { id: 'a2', email: 'super@x.com', role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'user' as const, isActive: true }
  const allTiles = ADMIN_TILE_IDS.map(id => ({ id, enabled: true }))

  it('lets the super admin save a layout that includes the super-admin tile', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockGetActor.mockResolvedValue(superAdminActor)
    const result = await saveAdminLayout({ tiles: allTiles })
    expect(result).toEqual({})
    expect(mockRepo.setAdminLayout).toHaveBeenCalledWith(superAdminActor, { tiles: allTiles })
  })

  it('strips the super-admin tile from a regular admin layout', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockGetActor.mockResolvedValue(regularAdmin)
    const result = await saveAdminLayout({ tiles: allTiles })
    expect(result).toEqual({})
    expect(mockRepo.setAdminLayout).toHaveBeenCalledWith(regularAdmin, {
      tiles: allTiles.filter(t => t.id !== 'super-admin'),
    })
  })

  it('accepts a regular admin layout that never mentions the super-admin tile', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockGetActor.mockResolvedValue(regularAdmin)
    const tiles = allTiles.filter(t => t.id !== 'super-admin')
    const result = await saveAdminLayout({ tiles })
    expect(result).toEqual({})
    expect(mockRepo.setAdminLayout).toHaveBeenCalledWith(regularAdmin, { tiles })
  })

  it('rejects layouts with a wrong tile set', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockGetActor.mockResolvedValue(regularAdmin)
    const result = await saveAdminLayout({ tiles: [{ id: 'settings', enabled: true }] })
    expect(result.error).toContain('Invalid layout')
    expect(mockRepo.setAdminLayout).not.toHaveBeenCalled()
  })
})

describe('super-admin gating', () => {
  const superAdmin = { id: 'a1', email: 'super@x.com', role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'user' as const, isActive: true }
  const otherAdmin = { id: 'a2', email: 'other@x.com', role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'user' as const, isActive: true }

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
describe('write rate limit semantics', () => {
  it('consumes the daily write budget only on a successful logEntry', async () => {
    const ok = await logEntry(input)
    expect(ok.error).toBeUndefined()
    expect(dailyWriteStore.get('writes:user-1')?.count).toBe(1)
  })

  it('does NOT consume the budget on a validation failure or a failed write', async () => {
    // Invalid input: rejected before the write.
    const invalid = await logEntry({ ...input, hoursWorked: -5 })
    expect(invalid.error).toBeTruthy()
    expect(dailyWriteStore.get('writes:user-1')).toBeUndefined()

    // Valid input but the DB write reports an error: budget stays uncharged.
    const okInput = { ...input }
    mockRepo.sumHoursForUserDate.mockResolvedValue(20) // would exceed 24h -> rejected
    const over = await logEntry(okInput)
    expect(over.error).toBeTruthy()
    expect(dailyWriteStore.get('writes:user-1')).toBeUndefined()
  })
})

describe('bulkUpdateTimesheets', () => {
  const owned = {
    id: 'e1',
    user_id: 'user-1',
    project_id: 'p1',
    activity_type_id: 'a1',
    hours_worked: 8,
    work_done: 'x',
    log_date: todayISO(),
  }

  beforeEach(() => {
    mockRepo.getTimesheet.mockResolvedValue(owned)
    mockRepo.getTimesheetsByIds.mockImplementation(async (_actor: unknown, ids: string[]) => {
      return ids.map((id: string) => ({ ...owned, id }))
    })
    mockRepo.sumHoursForUserDates.mockImplementation(async (_actor: unknown, pairs: Array<{ userId: string; logDate: string }>) => {
      const m = new Map<string, number>()
      pairs.forEach((p: { userId: string; logDate: string }) => m.set(`${p.userId}:${p.logDate}`, 0))
      return m
    })
  })

  it('applies all rows in one round trip but charges the write budget exactly once', async () => {
    mockRepo.bulkUpdateTimesheets.mockResolvedValue({ updated: 2, rowErrors: [], error: null })
    const result = await bulkUpdateTimesheets([
      { id: 'e1', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 8, workDone: 'x', logDate: todayISO() },
      { id: 'e2', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 8, workDone: 'y', logDate: todayISO() },
    ])
    expect(result.error).toBeUndefined()
    expect(result.updated).toBe(2)
    // Exactly 1 target read and 1 daily-totals read before the write
    expect(mockRepo.getTimesheetsByIds).toHaveBeenCalledTimes(1)
    expect(mockRepo.sumHoursForUserDates).toHaveBeenCalledTimes(1)
    // A single backend round trip, not per-row updateTimesheet calls (Phase 4.4).
    expect(mockRepo.bulkUpdateTimesheets).toHaveBeenCalledTimes(1)
    expect(mockRepo.bulkUpdateTimesheets).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([
      expect.objectContaining({ id: 'e1' }),
      expect.objectContaining({ id: 'e2' }),
    ]))
    expect(mockRepo.updateTimesheet).not.toHaveBeenCalled()
    expect(dailyWriteStore.get('writes:user-1')?.count).toBe(1)
  })

  it('reports per-row errors and only charges when at least one row succeeds', async () => {
    mockRepo.getTimesheetsByIds.mockResolvedValueOnce([{ ...owned, id: 'e2' }]) // first row not found
    mockRepo.bulkUpdateTimesheets.mockResolvedValue({ updated: 1, rowErrors: [], error: null })
    const result = await bulkUpdateTimesheets([
      { id: 'missing', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 8, workDone: 'x', logDate: todayISO() },
      { id: 'e2', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 8, workDone: 'y', logDate: todayISO() },
    ])
    expect(result.updated).toBe(1)
    expect(result.errors?.length).toBe(1)
    // Only the surviving row is handed to the backend in one call.
    expect(mockRepo.bulkUpdateTimesheets).toHaveBeenCalledTimes(1)
    expect(mockRepo.bulkUpdateTimesheets).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ id: 'e2' })])
    expect(dailyWriteStore.get('writes:user-1')?.count).toBe(1)
  })

  it('surfaces per-row backend failures even on a partial success', async () => {
    mockRepo.bulkUpdateTimesheets.mockResolvedValue({ updated: 1, rowErrors: [{ id: 'e2', error: 'you can only modify your own entries' }], error: null })
    const result = await bulkUpdateTimesheets([
      { id: 'e1', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 8, workDone: 'x', logDate: todayISO() },
      { id: 'e2', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 8, workDone: 'y', logDate: todayISO() },
    ])
    expect(result.updated).toBe(1)
    expect(result.error).toBeUndefined() // not all failed
    expect(result.errors).toEqual([expect.stringContaining('e2')])
    expect(dailyWriteStore.get('writes:user-1')?.count).toBe(1)
  })

  it.each([1, 10, 100])('maintains constant O(1) repo read calls for %i entries', async (count) => {
    const entries = Array.from({ length: count }, (_, i) => ({
      id: `e-${i}`,
      projectId: 'p1',
      activityTypeId: 'a1',
      hoursWorked: 0.1,
      workDone: `Work ${i}`,
      logDate: todayISO(),
    }))

    mockRepo.getTimesheetsByIds.mockResolvedValueOnce(
      entries.map((e) => ({ ...owned, id: e.id, hours_worked: 0.1 }))
    )
    mockRepo.sumHoursForUserDates.mockResolvedValueOnce(
      new Map([[`user-1:${todayISO()}`, 0.1 * count]])
    )
    mockRepo.bulkUpdateTimesheets.mockResolvedValueOnce({ updated: count, rowErrors: [], error: null })

    const result = await bulkUpdateTimesheets(entries)
    expect(result.updated).toBe(count)
    expect(mockRepo.getTimesheetsByIds).toHaveBeenCalledTimes(1)
    expect(mockRepo.sumHoursForUserDates).toHaveBeenCalledTimes(1)
    expect(mockRepo.bulkUpdateTimesheets).toHaveBeenCalledTimes(1)
  })

  it('rejects entries when cumulative daily hours exceed 24', async () => {
    mockRepo.getTimesheetsByIds.mockResolvedValueOnce([
      { ...owned, id: 'e1', hours_worked: 5 },
      { ...owned, id: 'e2', hours_worked: 5 },
    ])
    mockRepo.sumHoursForUserDates.mockResolvedValueOnce(
      new Map([[`user-1:${todayISO()}`, 10]])
    )

    const result = await bulkUpdateTimesheets([
      { id: 'e1', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 15, workDone: 'x', logDate: todayISO() },
      { id: 'e2', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 15, workDone: 'y', logDate: todayISO() },
    ])

    // e1 succeeds (15h <= 24h), e2 exceeds (15 + 15 = 30 > 24)
    expect(result.errors).toEqual([expect.stringContaining('daily total would exceed 24 hours')])
    expect(mockRepo.bulkUpdateTimesheets).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ id: 'e1' })])
  })
})

describe('default panel layouts (super-admin)', () => {
  const dashLayout = { tiles: TILE_IDS.map(id => ({ id, enabled: true })) }
  const adminLayout = { tiles: ADMIN_TILE_IDS.map(id => ({ id, enabled: true })) }

  beforeEach(() => {
    mockRepo.getDefaultLayouts.mockResolvedValue({ data: { dashboard: dashLayout, admin: adminLayout }, error: null })
    mockRepo.setDefaultLayouts.mockResolvedValue({ error: null })
  })

  it('getDefaultLayouts requires a session and returns the stored defaults', async () => {
    mockGetActor.mockResolvedValue(null)
    expect(await getDefaultLayouts()).toEqual({ error: 'You must be signed in.' })

    mockGetActor.mockResolvedValue(actor)
    const out = await getDefaultLayouts()
    expect('error' in out).toBe(false)
    expect(mockRepo.getDefaultLayouts).toHaveBeenCalledWith(actor)
  })

  it('getDefaultLayouts surfaces repo error as action error', async () => {
    mockGetActor.mockResolvedValue(actor)
    mockRepo.getDefaultLayouts.mockResolvedValue({ data: null, error: 'DB failure' })
    const out = await getDefaultLayouts()
    expect(out).toEqual({ error: 'DB failure' })
  })

  it('getDefaultLayouts swallows a throwing backend into an action error', async () => {
    mockGetActor.mockResolvedValue(actor)
    mockRepo.getDefaultLayouts.mockRejectedValue(new Error('connection refused'))
    const out = await getDefaultLayouts()
    expect(out).toEqual({ error: 'connection refused' })
  })

  it('setDefaultLayouts is super-admin only', async () => {
    mockGetActor.mockResolvedValue(actor) // regular user
    const res = await setDefaultLayouts(dashLayout, adminLayout)
    expect(res.error).toContain('permission')
    expect(mockRepo.setDefaultLayouts).not.toHaveBeenCalled()
  })

  it('setDefaultLayouts persists valid layouts for the super-admin', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    const superAdmin = { id: 'a1', email: 'super@x.com', role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'user' as const, isActive: true }
    mockGetActor.mockResolvedValue(superAdmin)
    expect(await setDefaultLayouts(dashLayout, adminLayout)).toEqual({})
    expect(mockRepo.setDefaultLayouts).toHaveBeenCalledWith(superAdmin, { dashboard: dashLayout, admin: adminLayout })
  })

  it('setDefaultLayouts rejects incomplete layouts', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockGetActor.mockResolvedValue({ id: 'a1', email: 'super@x.com', role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'user' as const, isActive: true })
    const incomplete = { tiles: [{ id: 'entry-form', enabled: true }] }
    expect((await setDefaultLayouts(incomplete as DashboardLayout, adminLayout)).error).toContain('dashboard')
    expect(mockRepo.setDefaultLayouts).not.toHaveBeenCalled()
  })
})
