import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeRepository } from '../lib/db/native'
import { query, getPool } from '../lib/db/pool'
import type { Actor } from '../lib/db/repository'

vi.mock('../lib/db/pool', () => ({
  query: vi.fn(),
  getPool: vi.fn(),
}))

const mockQuery = vi.mocked(query)
const mockGetPool = vi.mocked(getPool)

const admin: Actor = { id: 'admin-1', email: 'admin@x.com', role: 'admin', permission_role: 'admin', hierarchy_role: 'user', isActive: true }
const co: Actor = { id: 'co-1', email: 'co@x.com', role: 'co', permission_role: 'co', hierarchy_role: 'user', isActive: true }
const pm: Actor = { id: 'pm-1', email: 'pm@x.com', role: 'pm', permission_role: 'pm', hierarchy_role: 'user', isActive: true }
const manager: Actor = { id: 'mgr-1', email: 'mgr@x.com', role: 'manager', permission_role: 'user', hierarchy_role: 'manager', isActive: true }
const teamLead: Actor = { id: 'tl-1', email: 'tl@x.com', role: 'team_lead', permission_role: 'user', hierarchy_role: 'team_lead', isActive: true }
const user: Actor = { id: 'user-1', email: 'user@x.com', role: 'user', permission_role: 'user', hierarchy_role: 'user', isActive: true }
const inactive: Actor = { id: 'user-2', email: 'inactive@x.com', role: 'user', permission_role: 'user', hierarchy_role: 'user', isActive: false }

beforeEach(() => {
  mockQuery.mockReset()
  mockGetPool.mockReset()
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

  it('applies an explicit userId filter for admins', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeRepository.listTimesheets(admin, { userId: 'target-1' })

    const sql = mockQuery.mock.calls[1][0]
    expect(sql).toContain('where t.user_id = $1')
    expect(mockQuery.mock.calls[1][1]).toEqual(['target-1'])
  })

  it('intersects an explicit userId filter with the actor scope', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeRepository.listTimesheets(user, { userId: 'someone-else' })

    const sql = mockQuery.mock.calls[1][0]
    expect(sql).toContain('where t.user_id = $1 and t.user_id = $2')
    expect(mockQuery.mock.calls[1][1]).toEqual([user.id, 'someone-else'])
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
    const result = await nativeRepository.updateUserRoles(pm, 'u', 'admin', 'user')
    expect(result.error).toContain('permission')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('scopes reminders to the actor regardless of requested userId', async () => {
    mockQuery.mockResolvedValueOnce([])
    await nativeRepository.listReminders(user, 'someone-else')
    expect(mockQuery.mock.calls[0][1]).toEqual([user.id])
  })

  it('returns no daily hour totals for non-admin actors', async () => {
    const result = await nativeRepository.getTimesheetDailyTotals(user)
    expect(result).toEqual([])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('aggregates daily hour totals in SQL for admin actors', async () => {
    mockQuery.mockResolvedValueOnce([
      { user_id: 'user-1', log_date: '2024-01-01', hours: 7.5 },
    ])
    const result = await nativeRepository.getTimesheetDailyTotals(admin)
    expect(result).toEqual([{ userId: 'user-1', logDate: '2024-01-01', hours: 7.5 }])
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('group by')
    expect(sql).toContain('user_id')
    expect(mockQuery.mock.calls[0][1]).toBeUndefined()
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

describe('native repository getDefaultLayouts (DbResult contract)', () => {
  it('returns { data, error: null } on success with explicit layout', async () => {
    const layout = { tiles: [{ id: 'timesheet', enabled: true }] }
    const adminLayout = { tiles: [{ id: 'users', enabled: true }] }
    mockQuery.mockResolvedValueOnce([{
      default_dashboard_layout: layout,
      default_admin_layout: adminLayout,
    }])

    const result = await nativeRepository.getDefaultLayouts(admin)
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ dashboard: layout, admin: adminLayout })
  })

  it('falls back to default layouts when app_settings row has null columns', async () => {
    mockQuery.mockResolvedValueOnce([{
      default_dashboard_layout: null,
      default_admin_layout: null,
    }])

    const result = await nativeRepository.getDefaultLayouts(admin)
    expect(result.error).toBeNull()
    expect(result.data).not.toBeNull()
    // Must have tiles arrays (from DEFAULT_DASHBOARD_LAYOUT / DEFAULT_ADMIN_LAYOUT constants)
    expect(Array.isArray(result.data?.dashboard?.tiles)).toBe(true)
    expect(Array.isArray(result.data?.admin?.tiles)).toBe(true)
  })

  it('returns { data: null, error: message } when the query throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'))

    const result = await nativeRepository.getDefaultLayouts(admin)
    expect(result.data).toBeNull()
    expect(result.error).toBe('connection refused')
  })

  it('returns a generic error message when a non-Error is thrown', async () => {
    mockQuery.mockRejectedValueOnce('oops')

    const result = await nativeRepository.getDefaultLayouts(admin)
    expect(result.data).toBeNull()
    expect(result.error).toBeTruthy()
  })
})

describe('native repository bulkUpdateTimesheets (Phase 4.4)', () => {
  function makeClient() {
    const queries: unknown[][] = []
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push(params ?? [])
        if (sql.includes('begin') || sql.includes('commit')) return { rows: [] }
        if (sql.includes('rollback')) return { rows: [] }
        return { rowCount: 1 }
      }),
      release: vi.fn(),
    }
    mockGetPool.mockReturnValue({ connect: vi.fn(async () => client) } as never)
    return { client, queries }
  }

  it('updates every row in one transaction scope with ownership enforced', async () => {
    const { queries } = makeClient()
    const result = await nativeRepository.bulkUpdateTimesheets(user, [
      { id: 't1', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 5, workDone: 'x', logDate: '2026-01-01' },
      { id: 't2', projectId: 'p2', activityTypeId: null, hoursWorked: 3, workDone: 'y', logDate: '2026-01-02' },
    ])
    expect(result.error).toBeNull()
    expect(result.updated).toBe(2)
    // Every UPDATE WHERE includes the actor scope for a non-admin (the final
    // param of each row UPDATE is the actor id; begin/commit carry no params).
    const updateParams = queries.filter(p => p.length >= 2)
    expect(updateParams.length).toBe(2)
    for (const params of updateParams) {
      expect(params[params.length - 1]).toBe(user.id)
    }
  })

  it('returns rowErrors for rows the actor cannot edit (scope enforced in SQL)', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('begin') || sql.includes('commit') || sql.includes('rollback')) return { rows: [] }
        return { rowCount: 0 }
      }),
      release: vi.fn(),
    }
    mockGetPool.mockReturnValue({ connect: vi.fn(async () => client) } as never)

    const result = await nativeRepository.bulkUpdateTimesheets(user, [{ id: 't1', projectId: 'p1', activityTypeId: null, hoursWorked: 1, workDone: 'x', logDate: '2026-01-01' }])
    expect(result.updated).toBe(0)
    expect(result.rowErrors[0].id).toBe('t1')
    expect(result.rowErrors[0].error).toMatch(/own entries/)
  })

  it('scopes a CO bulk edit to their own rows (CO may see all but edit only own)', async () => {
    const { queries } = makeClient()
    const result = await nativeRepository.bulkUpdateTimesheets(co, [
      { id: 't1', projectId: 'p1', activityTypeId: null, hoursWorked: 1, workDone: 'x', logDate: '2026-01-01' },
    ])
    expect(result.error).toBeNull()
    // The single UPDATE must carry the CO's id as the ownership scope param.
    const updateParams = queries.filter(p => p.length >= 2)
    expect(updateParams.length).toBe(1)
    expect(updateParams[0][updateParams[0].length - 1]).toBe(co.id)
  })

  it('returns empty result for no rows', async () => {
    const result = await nativeRepository.bulkUpdateTimesheets(admin, [])
    expect(result).toEqual({ updated: 0, rowErrors: [], error: null })
    expect(mockGetPool).not.toHaveBeenCalled()
  })
})

describe('native repository work_done sanitization on bulk paths', () => {
  const dirty = '<script>x</script>logged   <b>work</b>'
  const clean = 'logged work'

  it('sanitizes work_done in importTimesheets inserts', async () => {
    // importTimesheets issues one multi-row INSERT through the pool itself.
    const poolQuery = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount: 1, rows: [] }))
    mockGetPool.mockReturnValue({ query: poolQuery } as never)
    const result = await nativeRepository.importTimesheets(admin, [
      { userId: 'u1', projectId: 'p1', activityTypeId: null, hoursWorked: 1, workDone: dirty, logDate: '2026-01-01' },
    ])
    expect(result.error).toBeNull()
    const insertCall = poolQuery.mock.calls.find(([sql]) => String(sql).includes('insert into public.timesheets'))
    expect(insertCall).toBeDefined()
    expect(insertCall![1]![5]).toBe(clean)
  })

  it('sanitizes work_done in restoreBackup timesheet inserts', async () => {
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('begin') || sql.includes('commit') || sql.includes('rollback')) return { rows: [] }
        if (sql.includes(' from public.profiles')) return { rows: [{ id: 'u1', email: 'a@x.com' }] }
        if (sql.includes(' from public.')) return { rows: [] }
        return { rows: [{ id: 'new-id' }], rowCount: 1 }
      }),
      release: vi.fn(),
    }
    mockGetPool.mockReturnValue({ connect: vi.fn(async () => client) } as never)

    const result = await nativeRepository.restoreBackup(admin, {
      version: 1,
      exportedAt: '2026-08-20T00:00:00.000Z',
      projects: [{ name: 'Alpha', so_number: null, telegram_no: null }],
      activityTypes: [],
      timesheets: [
        { email: 'a@x.com', log_date: '2026-08-19', project: 'Alpha', activity_type: null, hours_worked: 8, work_done: dirty },
      ],
      leaves: [],
      reminders: [],
      globalReminders: [],
    })
    expect(result.error).toBeNull()
    expect(result.created.timesheets).toBe(1)
    const insertCall = client.query.mock.calls.find(([sql]) => String(sql).includes('insert into public.timesheets'))
    expect(insertCall).toBeDefined()
    expect(insertCall![1]![5]).toBe(clean)
  })
})

describe('native repository getGroupedReportTotals (Phase 4.5)', () => {
  it('aggregates by the requested groupBy in a single SQL query', async () => {
    mockQuery.mockResolvedValueOnce([
      { label: 'Alpha', hours: 4, entries: 1 },
      { label: 'Beta', hours: 6, entries: 1 },
    ])
    const result = await nativeRepository.getGroupedReportTotals(admin, { from: '2026-01-01', to: '2026-01-31' }, 'project')
    expect(result).toEqual([
      { label: 'Alpha', hours: 4, entries: 1 },
      { label: 'Beta', hours: 6, entries: 1 },
    ])
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('group by')
    expect(sql).toContain("'Unknown project'")
  })

  it('applies project and date filters to the scope', async () => {
    mockQuery.mockResolvedValueOnce([])
    const result = await nativeRepository.getGroupedReportTotals(user, { projectId: 'p1', from: '2026-01-01' }, 'user')
    expect(result).toEqual([])
    const params = mockQuery.mock.calls[0][1]
    expect(params).toContain(user.id) // scope
    expect(params).toContain('p1')
    expect(params).toContain('2026-01-01')
  })
})
