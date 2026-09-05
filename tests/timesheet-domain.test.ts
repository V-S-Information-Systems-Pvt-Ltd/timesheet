import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  createTimesheetEntry,
  updateTimesheetEntry,
  deleteTimesheetEntry,
  duplicateTimesheetEntry,
  deleteLastTimesheetEntryDomain,
  bulkUpdateTimesheetsDomain,
  listTimesheetsDomain,
  type DomainTimesheetInput,
  type TimesheetDomainDeps,
} from '@/lib/domain/timesheets'
import type { Actor } from '@/lib/db/repository'

describe('Timesheet Domain Service', () => {
  const regularActor: Actor = {
    id: 'user-1',
    email: 'user@example.com',
    role: 'user',
    permission_role: 'user',
    hierarchy_role: 'engineer',
    isActive: true,
  }

  const adminActor: Actor = {
    id: 'admin-1',
    email: 'admin@example.com',
    role: 'admin',
    permission_role: 'admin',
    hierarchy_role: 'manager',
    isActive: true,
  }

  const mockRepo = {
    createTimesheet: vi.fn(),
    updateTimesheet: vi.fn(),
    deleteTimesheet: vi.fn(),
    getTimesheet: vi.fn(),
    getTimesheetsByIds: vi.fn(),
    getLatestTimesheet: vi.fn(),
    sumHoursForUserDate: vi.fn(),
    sumHoursForUserDates: vi.fn(),
    getBackfillWindow: vi.fn(),
    bulkUpdateTimesheets: vi.fn(),
    listTimesheets: vi.fn(),
  }

  const todayStr = '2026-09-06'
  const deps: TimesheetDomainDeps = {
    repo: mockRepo as unknown as TimesheetDomainDeps['repo'],
    today: () => todayStr,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockRepo.getBackfillWindow.mockResolvedValue({ mode: 'days', windowDays: 7, extraDays: 0 })
    mockRepo.sumHoursForUserDate.mockResolvedValue(0)
    mockRepo.createTimesheet.mockResolvedValue({ id: 'ts-new', error: null })
    mockRepo.updateTimesheet.mockResolvedValue({ error: null })
    mockRepo.deleteTimesheet.mockResolvedValue({ error: null })
  })

  describe('createTimesheetEntry', () => {
    const validInput: DomainTimesheetInput = {
      projectId: 'p1',
      activityTypeId: 'a1',
      hoursWorked: 4,
      workDone: 'Feature implementation',
      logDate: todayStr,
    }

    it('creates timesheet entry within backfill window and 24h cap', async () => {
      const result = await createTimesheetEntry(regularActor, validInput, deps)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.success).toBe(true)
        expect(result.data.id).toBe('ts-new')
      }
      expect(mockRepo.createTimesheet).toHaveBeenCalledWith(regularActor, {
        userId: 'user-1',
        projectId: 'p1',
        activityTypeId: 'a1',
        hoursWorked: 4,
        workDone: 'Feature implementation',
        logDate: todayStr,
      })
    })

    it('rejects regular user logging time for another user with FORBIDDEN', async () => {
      const result = await createTimesheetEntry(
        regularActor,
        { ...validInput, userId: 'other-user' },
        deps
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN')
      }
      expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
    })

    it('allows admin logging time for another user', async () => {
      const result = await createTimesheetEntry(
        adminActor,
        { ...validInput, userId: 'other-user' },
        deps
      )
      expect(result.ok).toBe(true)
      expect(mockRepo.createTimesheet).toHaveBeenCalledWith(
        adminActor,
        expect.objectContaining({ userId: 'other-user' })
      )
    })

    it('rejects dates outside the backfill window for regular users', async () => {
      const result = await createTimesheetEntry(
        regularActor,
        { ...validInput, logDate: '2026-08-01' },
        deps
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('OUTSIDE_WINDOW')
      }
      expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
    })

    it('rejects when daily hours exceed 24', async () => {
      mockRepo.sumHoursForUserDate.mockResolvedValue(22)
      const result = await createTimesheetEntry(
        regularActor,
        { ...validInput, hoursWorked: 4 },
        deps
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('DAILY_HOURS_EXCEEDED')
        expect(result.error.message).toContain('exceed 24 hours')
      }
      expect(mockRepo.createTimesheet).not.toHaveBeenCalled()
    })
  })

  describe('updateTimesheetEntry', () => {
    const existingEntry = {
      id: 'ts-1',
      user_id: 'user-1',
      project_id: 'p1',
      activity_type_id: 'a1',
      hours_worked: 4,
      work_done: 'initial',
      log_date: todayStr,
    }

    const updateInput: DomainTimesheetInput = {
      projectId: 'p2',
      activityTypeId: 'a2',
      hoursWorked: 6,
      workDone: 'updated text',
      logDate: todayStr,
    }

    it('updates own entry successfully', async () => {
      mockRepo.getTimesheet.mockResolvedValue(existingEntry)
      const result = await updateTimesheetEntry(regularActor, 'ts-1', updateInput, deps)
      expect(result.ok).toBe(true)
      expect(mockRepo.updateTimesheet).toHaveBeenCalledWith(regularActor, 'ts-1', {
        userId: 'user-1',
        projectId: 'p2',
        activityTypeId: 'a2',
        hoursWorked: 6,
        workDone: 'updated text',
        logDate: todayStr,
      })
    })

    it('returns NOT_FOUND when entry does not exist', async () => {
      mockRepo.getTimesheet.mockResolvedValue(null)
      const result = await updateTimesheetEntry(regularActor, 'missing-id', updateInput, deps)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('rejects editing another user entry by non-admin', async () => {
      mockRepo.getTimesheet.mockResolvedValue({ ...existingEntry, user_id: 'other-user' })
      const result = await updateTimesheetEntry(regularActor, 'ts-1', updateInput, deps)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN')
      }
    })

    it('allows admin to edit other user entry', async () => {
      mockRepo.getTimesheet.mockResolvedValue({ ...existingEntry, user_id: 'other-user' })
      const result = await updateTimesheetEntry(adminActor, 'ts-1', updateInput, deps)
      expect(result.ok).toBe(true)
    })

    it('rejects moving entry outside the window', async () => {
      mockRepo.getTimesheet.mockResolvedValue(existingEntry)
      const result = await updateTimesheetEntry(
        regularActor,
        'ts-1',
        { ...updateInput, logDate: '2026-08-01' },
        deps
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('OUTSIDE_WINDOW')
      }
    })
  })

  describe('deleteTimesheetEntry', () => {
    const existingEntry = {
      id: 'ts-1',
      user_id: 'user-1',
      log_date: todayStr,
    }

    it('deletes own entry successfully', async () => {
      mockRepo.getTimesheet.mockResolvedValue(existingEntry)
      const result = await deleteTimesheetEntry(regularActor, 'ts-1', deps)
      expect(result.ok).toBe(true)
      expect(mockRepo.deleteTimesheet).toHaveBeenCalledWith(regularActor, 'ts-1')
    })

    it('rejects non-admin deleting another user entry', async () => {
      mockRepo.getTimesheet.mockResolvedValue({ ...existingEntry, user_id: 'other-user' })
      const result = await deleteTimesheetEntry(regularActor, 'ts-1', deps)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN')
      }
    })

    it('allows admin deleting another user entry', async () => {
      mockRepo.getTimesheet.mockResolvedValue({ ...existingEntry, user_id: 'other-user' })
      const result = await deleteTimesheetEntry(adminActor, 'ts-1', deps)
      expect(result.ok).toBe(true)
      expect(mockRepo.deleteTimesheet).toHaveBeenCalledWith(adminActor, 'ts-1')
    })
  })

  describe('duplicateTimesheetEntry', () => {
    const existingEntry = {
      id: 'ts-1',
      user_id: 'user-1',
      project_id: 'p1',
      activity_type_id: 'a1',
      hours_worked: 4,
      work_done: 'done',
      log_date: todayStr,
    }

    it('duplicates entry with identical fields', async () => {
      mockRepo.getTimesheet.mockResolvedValue(existingEntry)
      const result = await duplicateTimesheetEntry(regularActor, 'ts-1', null, deps)
      expect(result.ok).toBe(true)
      expect(mockRepo.createTimesheet).toHaveBeenCalledWith(
        regularActor,
        expect.objectContaining({
          userId: 'user-1',
          projectId: 'p1',
          hoursWorked: 4,
          logDate: todayStr,
        })
      )
    })

    it('duplicates to targetDate when provided', async () => {
      mockRepo.getTimesheet.mockResolvedValue(existingEntry)
      const targetDate = '2026-09-05'
      const result = await duplicateTimesheetEntry(regularActor, 'ts-1', targetDate, deps)
      expect(result.ok).toBe(true)
      expect(mockRepo.createTimesheet).toHaveBeenCalledWith(
        regularActor,
        expect.objectContaining({ logDate: targetDate })
      )
    })
  })

  describe('deleteLastTimesheetEntryDomain', () => {
    it('deletes latest entry for actor', async () => {
      mockRepo.getLatestTimesheet.mockResolvedValue({ id: 'ts-last', log_date: todayStr })
      const result = await deleteLastTimesheetEntryDomain(regularActor, deps)
      expect(result.ok).toBe(true)
      expect(mockRepo.deleteTimesheet).toHaveBeenCalledWith(regularActor, 'ts-last')
    })

    it('returns NOT_FOUND when no entries exist to undo', async () => {
      mockRepo.getLatestTimesheet.mockResolvedValue(null)
      const result = await deleteLastTimesheetEntryDomain(regularActor, deps)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND')
        expect(result.error.message).toBe('No entries to undo.')
      }
    })
  })

  describe('bulkUpdateTimesheetsDomain', () => {
    it('rejects empty entry array', async () => {
      const result = await bulkUpdateTimesheetsDomain(regularActor, [], deps)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('rejects more than 500 entries', async () => {
      const entries = Array.from({ length: 501 }, (_, i) => ({
        id: `ts-${i}`,
        projectId: 'p1',
        activityTypeId: 'a1',
        hoursWorked: 1,
        workDone: 'work',
        logDate: todayStr,
      }))
      const result = await bulkUpdateTimesheetsDomain(regularActor, entries, deps)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })
  })

  describe('listTimesheetsDomain', () => {
    it('delegates to repo.listTimesheets with options', async () => {
      mockRepo.listTimesheets.mockResolvedValue({ rows: [], count: 0 })
      const result = await listTimesheetsDomain(regularActor, { limit: 10 }, deps)
      expect(result.ok).toBe(true)
      expect(mockRepo.listTimesheets).toHaveBeenCalledWith(regularActor, { limit: 10 })
    })
  })
})
