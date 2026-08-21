import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeRepository } from '../lib/db/native'
import { query, transaction } from '../lib/db/pool'
import type { Actor } from '../lib/db/repository'

const mockClient = { query: vi.fn() }

vi.mock('../lib/db/pool', () => ({
  query: vi.fn(),
  transaction: vi.fn(async (fn) => fn(mockClient)),
}))

const mockQuery = vi.mocked(query)
const mockTransaction = vi.mocked(transaction)

const admin: Actor = { id: 'admin-1', email: 'admin@x.com', role: 'admin', isActive: true }
const co: Actor = { id: 'co-1', email: 'co@x.com', role: 'co', isActive: true }
const pm: Actor = { id: 'pm-1', email: 'pm@x.com', role: 'pm', isActive: true }
const manager: Actor = { id: 'mgr-1', email: 'mgr@x.com', role: 'manager', isActive: true }
const teamLead: Actor = { id: 'tl-1', email: 'tl@x.com', role: 'team_lead', isActive: true }
const user: Actor = { id: 'user-1', email: 'user@x.com', role: 'user', isActive: true }
const inactive: Actor = { id: 'user-2', email: 'inactive@x.com', role: 'user', isActive: false }

beforeEach(() => {
  mockQuery.mockReset()
})

describe('native repository authorization', () => {
  it('scopes timesheet reads to the actor for regular users', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeRepository.listTimesheets(user)

    const sql = mockQuery.mock.calls[1][0]
    expect(sql).toContain('where t.user_id = $1')
    expect(mockQuery.mock.calls[1][1]).toEqual([user.id])
  })

  it('lets admin read all timesheets without a user filter', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeRepository.listTimesheets(admin)

    const sql = mockQuery.mock.calls[1][0]
    expect(sql).not.toMatch(/where t\.user_id/)
    expect(mockQuery.mock.calls[1][1]).toEqual([])
  })

  it('blocks a regular user from reading another user\'s timesheet', async () => {
    const result = await nativeRepository.findTimesheetByUserDate(user, 'other-id', '2024-01-01')
    expect(result).toBeNull()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('lets a CO read another user\'s timesheet', async () => {
    mockQuery.mockResolvedValueOnce([])
    await nativeRepository.findTimesheetByUserDate(co, 'other-id', '2024-01-01')
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('maps joined timesheet rows', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 1 }])
    mockQuery.mockResolvedValueOnce([
      {
        id: 't1',
        user_id: 'user-1',
        project_id: 'p1',
        log_date: '2024-01-01',
        hours_worked: 7.5,
        work_done: 'built things',
        created_at: '2024-01-01T00:00:00.000Z',
        project_name: 'Alpha',
        user_email: 'user@x.com',
      },
    ])

    const { rows, count } = await nativeRepository.listTimesheets(user)
    expect(count).toBe(1)
    expect(rows[0].projects?.name).toBe('Alpha')
    expect(rows[0].profiles?.email).toBe('user@x.com')
  })

  it('blocks a user from logging another user\'s entry', async () => {
    const result = await nativeRepository.createTimesheet(user, {
      userId: 'other-id',
      projectId: 'p',
      activityTypeId: 'at-1',
      hoursWorked: 1,
      workDone: 'x',
      logDate: '2024-01-01',
    })
    expect(result.error).toContain('own')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('blocks an inactive user from logging', async () => {
    const result = await nativeRepository.createTimesheet(inactive, {
      userId: inactive.id,
      projectId: 'p',
      activityTypeId: 'at-1',
      hoursWorked: 1,
      workDone: 'x',
      logDate: '2024-01-01',
    })
    expect(result.error).toContain('active')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('blocks non-admin role changes', async () => {
    const result = await nativeRepository.updateUserRole(pm, 'u', 'admin')
    expect(result.error).toContain('permission')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('scopes reminders to the actor regardless of requested userId', async () => {
    mockQuery.mockResolvedValueOnce([])
    await nativeRepository.listReminders(user, 'someone-else')
    expect(mockQuery.mock.calls[0][1]).toEqual([user.id])
  })
})

describe('native repository hierarchy visibility', () => {
  it('scopes manager timesheet reads to their team via team_ids', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeRepository.listTimesheets(manager)
    const sql = mockQuery.mock.calls[1][0]
    expect(sql).toContain('team_ids($1)')
    expect(mockQuery.mock.calls[1][1]).toEqual([manager.id])
  })

  it('scopes team-lead timesheet reads to their team via team_ids', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeRepository.listTimesheets(teamLead)
    const sql = mockQuery.mock.calls[1][0]
    expect(sql).toContain('team_ids($1)')
    expect(mockQuery.mock.calls[1][1]).toEqual([teamLead.id])
  })

  it('keeps a regular user scoped to their own timesheets', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeRepository.listTimesheets(user)
    const sql = mockQuery.mock.calls[1][0]
    expect(sql).toContain('where t.user_id = $1')
    expect(sql).not.toContain('team_ids')
  })

  it('lists own + team profiles for managers and team leads', async () => {
    mockQuery.mockResolvedValueOnce([])
    await nativeRepository.listProfiles(manager)
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('id = $1 or id = any(public.team_ids($1))')

    mockQuery.mockResolvedValueOnce([])
    await nativeRepository.listProfiles(teamLead)
    expect(mockQuery.mock.calls[1][0]).toContain('team_ids($1)')
  })

  it('returns no profile list for regular users', async () => {
    const result = await nativeRepository.listProfiles(user)
    expect(result).toEqual([])
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

describe('native repository transactions & error mapping', () => {
  it('translates 24-hour trigger exception to user-friendly message', async () => {
    const err = new Error('ERROR: Daily total would exceed 24 hours (20.00h already logged on 2026-08-21)')
    ;(err as unknown as { code: string }).code = 'P0001'
    mockQuery.mockRejectedValueOnce(err)

    const result = await nativeRepository.createTimesheet(admin, {
      userId: user.id,
      projectId: 'p1',
      activityTypeId: 'at1',
      hoursWorked: 5,
      workDone: 'overtime',
      logDate: '2026-08-21',
    })

    expect(result.error).toContain('Daily total would exceed 24 hours')
  })

  it('runs deleteProject within transaction and checks referencing rows', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ c: 0 }] }).mockResolvedValueOnce({ rows: [] })
    const result = await nativeRepository.deleteProject(admin, 'proj-1')
    expect(result.error).toBeNull()
    expect(mockTransaction).toHaveBeenCalled()
  })

  it('aborts deleteProject if entries reference project', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ c: 5 }] })
    const result = await nativeRepository.deleteProject(admin, 'proj-1')
    expect(result.error).toContain('5 entries reference this project')
  })
})

