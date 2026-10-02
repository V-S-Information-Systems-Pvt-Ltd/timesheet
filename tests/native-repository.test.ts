import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeLeaveReminderPersistence } from '../lib/db/native/leave-reminders'
import { nativeOperationsPersistence } from '../lib/db/native/operations'
import { nativePeoplePersistence } from '../lib/db/native/people'
import { nativeReferencePersistence } from '../lib/db/native/reference'
import { nativeReportingPersistence } from '../lib/db/native/reporting'
import { nativeTimesheetPersistence } from '../lib/db/native/timesheets'
import { nativeWorkspacePersistence } from '../lib/db/native/workspace'
import { query, getPool } from '../lib/db/pool'
import type { Actor } from '../lib/db/types'
import type { DashboardLayout, AdminDashboardLayout, MobileLayout } from '../app/types'

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
    await nativeTimesheetPersistence.list(user, {})

    const sql = mockQuery.mock.calls[1][0]
    expect(sql).toContain('where t.user_id = $1')
    expect(mockQuery.mock.calls[1][1]).toEqual([user.id])
  })

  it('lets admin read all timesheets without a user filter', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeTimesheetPersistence.list(admin, {})

    const sql = mockQuery.mock.calls[1][0]
    expect(sql).not.toMatch(/where t\.user_id/)
    expect(mockQuery.mock.calls[1][1]).toEqual([])
  })

  it('applies an explicit userId filter for admins', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeTimesheetPersistence.list(admin, { userId: 'target-1' })

    const sql = mockQuery.mock.calls[1][0]
    expect(sql).toContain('where t.user_id = $1')
    expect(mockQuery.mock.calls[1][1]).toEqual(['target-1'])
  })

  it('intersects an explicit userId filter with the actor scope', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeTimesheetPersistence.list(user, { userId: 'someone-else' })

    const sql = mockQuery.mock.calls[1][0]
    expect(sql).toContain('where t.user_id = $1 and t.user_id = $2')
    expect(mockQuery.mock.calls[1][1]).toEqual([user.id, 'someone-else'])
  })

  it('blocks a regular user from reading another user\'s timesheet', async () => {
    const result = await nativeTimesheetPersistence.getByUserDate(user, 'other-id', '2024-01-01')
    expect(result).toBeNull()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('lets a CO read another user\'s timesheet', async () => {
    mockQuery.mockResolvedValueOnce([])
    await nativeTimesheetPersistence.getByUserDate(co, 'other-id', '2024-01-01')
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

    const { rows, count } = await nativeTimesheetPersistence.list(user, {})
    expect(count).toBe(1)
    expect(rows[0].projects?.name).toBe('Alpha')
    expect(rows[0].profiles?.email).toBe('user@x.com')
  })

  it('blocks a user from logging another user\'s entry', async () => {
    const result = await nativeTimesheetPersistence.create(user, {
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

  it('restricts own timesheet updates to the configured backfill window', async () => {
    mockQuery.mockResolvedValueOnce([])
    const result = await nativeTimesheetPersistence.update(user, 't1', {
      projectId: 'p1',
      activityTypeId: null,
      hoursWorked: 1,
      workDone: 'x',
      logDate: '2026-08-31',
      userId: user.id,
    })

    expect(result.error).toBeNull()
    expect(mockQuery.mock.calls[0][0]).toContain('public.app_settings')
    expect(mockQuery.mock.calls[0][0]).toContain('backfill_window_days')
    expect(mockQuery.mock.calls[0][0]).toContain('backfill_extra_days')
  })

  it('restricts own timesheet deletes to the configured backfill window', async () => {
    mockQuery.mockResolvedValueOnce([])
    const result = await nativeTimesheetPersistence.remove(user, 't1')

    expect(result.error).toBeNull()
    expect(mockQuery.mock.calls[0][0]).toContain('public.app_settings')
    expect(mockQuery.mock.calls[0][0]).toContain('t.log_date <= current_date')
  })

  it('blocks an inactive user from logging', async () => {
    const result = await nativeTimesheetPersistence.create(inactive, {
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
    const result = await nativePeoplePersistence.updateUserRoles(pm, 'u', 'admin', 'user')
    expect(result.error).toContain('permission')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('scopes reminders to the actor regardless of requested userId', async () => {
    mockQuery.mockResolvedValueOnce([])
    await nativeLeaveReminderPersistence.listReminders(user, 'someone-else')
    expect(mockQuery.mock.calls[0][1]).toEqual([user.id])
  })
})

describe('native repository hierarchy visibility', () => {
  it('scopes manager timesheet reads to their team via team_ids', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeTimesheetPersistence.list(manager, {})
    const sql = mockQuery.mock.calls[1][0]
    expect(sql).toContain('team_ids($1)')
    expect(mockQuery.mock.calls[1][1]).toEqual([manager.id])
  })

  it('scopes team-lead timesheet reads to their team via team_ids', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeTimesheetPersistence.list(teamLead, {})
    const sql = mockQuery.mock.calls[1][0]
    expect(sql).toContain('team_ids($1)')
    expect(mockQuery.mock.calls[1][1]).toEqual([teamLead.id])
  })

  it('keeps a regular user scoped to their own timesheets', async () => {
    mockQuery.mockResolvedValueOnce([{ c: 0 }]).mockResolvedValueOnce([])
    await nativeTimesheetPersistence.list(user, {})
    const sql = mockQuery.mock.calls[1][0]
    expect(sql).toContain('where t.user_id = $1')
    expect(sql).not.toContain('team_ids')
  })

  it('skips count query when includeCount is false', async () => {
    mockQuery.mockResolvedValueOnce([])
    const result = await nativeTimesheetPersistence.list(user, { includeCount: false })
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('select')
    expect(sql).not.toContain('select count(*)')
    expect(result.count).toBe(0)
    expect(result.rows).toEqual([])
  })

  it('lists own + team profiles for managers and team leads', async () => {
    mockQuery.mockResolvedValueOnce([])
    await nativePeoplePersistence.listProfiles(manager)
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('id = $1 or id = any(public.team_ids($1))')

    mockQuery.mockResolvedValueOnce([])
    await nativePeoplePersistence.listProfiles(teamLead)
    expect(mockQuery.mock.calls[1][0]).toContain('team_ids($1)')
  })

  it('returns no profile list for regular users', async () => {
    const result = await nativePeoplePersistence.listProfiles(user)
    expect(result).toEqual([])
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

describe('native repository getDefaultLayouts (DbResult contract)', () => {
  it('returns { data, error: null } on success with explicit layout', async () => {
    const layout = { tiles: [{ id: 'timesheet', enabled: true }] }
    const adminLayout = { tiles: [{ id: 'users', enabled: true }] }
    const mobileLayout = { modules: [{ id: 'timesheets', enabled: true }] }
    mockQuery.mockResolvedValueOnce([{
      default_dashboard_layout: layout,
      default_admin_layout: adminLayout,
      default_mobile_layout: mobileLayout,
    }])

    const result = await nativeWorkspacePersistence.getDefaultLayouts(admin)
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ dashboard: layout, admin: adminLayout, mobile: mobileLayout })
  })

  it('falls back to default layouts when app_settings row has null columns', async () => {
    mockQuery.mockResolvedValueOnce([{
      default_dashboard_layout: null,
      default_admin_layout: null,
      default_mobile_layout: null,
    }])

    const result = await nativeWorkspacePersistence.getDefaultLayouts(admin)
    expect(result.error).toBeNull()
    expect(result.data).not.toBeNull()
    // Must have tiles/modules arrays (from DEFAULT_DASHBOARD_LAYOUT / DEFAULT_ADMIN_LAYOUT / DEFAULT_MOBILE_LAYOUT constants)
    expect(Array.isArray(result.data?.dashboard?.tiles)).toBe(true)
    expect(Array.isArray(result.data?.admin?.tiles)).toBe(true)
    expect(Array.isArray(result.data?.mobile?.modules)).toBe(true)
  })

  it('returns { data: null, error: message } when the query throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'))

    const result = await nativeWorkspacePersistence.getDefaultLayouts(admin)
    expect(result.data).toBeNull()
    expect(result.error).toBe('connection refused')
  })

  it('returns a generic error message when a non-Error is thrown', async () => {
    mockQuery.mockRejectedValueOnce('oops')

    const result = await nativeWorkspacePersistence.getDefaultLayouts(admin)
    expect(result.data).toBeNull()
    expect(result.error).toBeTruthy()
  })
})

describe('native repository setDefaultLayouts tri-state contract', () => {
  const superAdmin: Actor = { id: 'sa-1', email: 'admin@x.com', role: 'admin', permission_role: 'admin', hierarchy_role: 'manager', isActive: true }
  const dashLayout: DashboardLayout = { tiles: [{ id: 'entries', enabled: true }] }
  const admLayout: AdminDashboardLayout = { tiles: [{ id: 'settings', enabled: true }] }
  const mobLayout: MobileLayout = { modules: [{ id: 'timesheets', enabled: true, placement: 'home' }] }

  beforeEach(() => {
    process.env.SUPER_ADMIN_EMAIL = 'admin@x.com'
  })

  it('preserves default_mobile_layout when mobile is undefined', async () => {
    mockQuery.mockResolvedValueOnce([])
    const res = await nativeWorkspacePersistence.setDefaultLayouts(superAdmin, {
      dashboard: dashLayout,
      admin: admLayout,
      mobile: undefined,
    })
    expect(res.error).toBeNull()
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).not.toContain('default_mobile_layout')
    expect(mockQuery.mock.calls[0][1]).toEqual([JSON.stringify(dashLayout), JSON.stringify(admLayout)])
  })

  it('clears default_mobile_layout to NULL when mobile is null', async () => {
    mockQuery.mockResolvedValueOnce([])
    const res = await nativeWorkspacePersistence.setDefaultLayouts(superAdmin, {
      dashboard: dashLayout,
      admin: admLayout,
      mobile: null,
    })
    expect(res.error).toBeNull()
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('default_mobile_layout = $3')
    expect(sql).not.toContain('coalesce')
    expect(mockQuery.mock.calls[0][1]).toEqual([JSON.stringify(dashLayout), JSON.stringify(admLayout), null])
  })

  it('replaces default_mobile_layout with JSON when mobile is an object', async () => {
    mockQuery.mockResolvedValueOnce([])
    const res = await nativeWorkspacePersistence.setDefaultLayouts(superAdmin, {
      dashboard: dashLayout,
      admin: admLayout,
      mobile: mobLayout,
    })
    expect(res.error).toBeNull()
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('default_mobile_layout = $3')
    expect(mockQuery.mock.calls[0][1]).toEqual([JSON.stringify(dashLayout), JSON.stringify(admLayout), JSON.stringify(mobLayout)])
  })
})

describe('native repository bulkUpdateTimesheets (Phase 4.4 / F08)', () => {
  it('updates rows in a single set-based SQL query with ownership enforced', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }])
    const result = await nativeTimesheetPersistence.bulkUpdate(user, [
      { id: 't1', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 5, workDone: 'x', logDate: '2026-01-01' },
      { id: 't2', projectId: 'p2', activityTypeId: null, hoursWorked: 3, workDone: 'y', logDate: '2026-01-02' },
    ])
    expect(result.error).toBeNull()
    expect(result.updated).toBe(2)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const call = mockQuery.mock.calls[0]
    expect(call).toBeDefined()
    const [sql, params] = call!
    expect(sql).toContain('update public.timesheets as t')
    expect(sql).toContain('from (values ($1::uuid')
    expect(sql).toContain('t.user_id = $13')
    expect(params?.[params.length - 1]).toBe(user.id)
  })

  it('returns rowErrors for rows the actor cannot edit (scope enforced in SQL)', async () => {
    mockQuery.mockResolvedValueOnce([])

    const result = await nativeTimesheetPersistence.bulkUpdate(user, [{ id: 't1', projectId: 'p1', activityTypeId: null, hoursWorked: 1, workDone: 'x', logDate: '2026-01-01' }])
    expect(result.updated).toBe(0)
    expect(result.rowErrors[0].id).toBe('t1')
    expect(result.rowErrors[0].error).toMatch(/own entries/)
  })

  it('scopes a CO bulk edit to their own rows (CO may see all but edit only own)', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 't1' }])
    const result = await nativeTimesheetPersistence.bulkUpdate(co, [
      { id: 't1', projectId: 'p1', activityTypeId: null, hoursWorked: 1, workDone: 'x', logDate: '2026-01-01' },
    ])
    expect(result.error).toBeNull()
    // The single UPDATE must carry the CO's id as the ownership scope param.
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('t.user_id = $7')
    expect(params?.[params.length - 1]).toBe(co.id)
  })

  it('returns empty result for no rows', async () => {
    const result = await nativeTimesheetPersistence.bulkUpdate(admin, [])
    expect(result).toEqual({ updated: 0, rowErrors: [], error: null })
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

describe('native repository work_done sanitization on bulk paths', () => {
  const dirty = '<script>x</script>logged   <b>work</b>'
  const clean = 'logged work'

  it('sanitizes work_done in importTimesheets inserts', async () => {
    // importTimesheets issues one multi-row INSERT through the pool itself.
    const poolQuery = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount: 1, rows: [] }))
    mockGetPool.mockReturnValue({ query: poolQuery } as never)
    const result = await nativeOperationsPersistence.importTimesheets(admin, [
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

    const result = await nativeOperationsPersistence.restoreBackup(admin, {
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

  it('deduplicates reminders and global reminders in restoreBackup', async () => {
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('begin') || sql.includes('commit') || sql.includes('rollback')) return { rows: [] }
        if (sql.includes(' from public.profiles')) return { rows: [{ id: 'u1', email: 'a@x.com' }] }
        if (sql.includes(' from public.reminders')) return { rows: [{ user_id: 'u1', message: 'Existing', remind_at: '2026-08-20T10:00:00.000Z' }] }
        if (sql.includes(' from public.global_reminders')) return { rows: [{ message: 'Global', remind_at: '2026-08-20T10:00:00.000Z' }] }
        if (sql.includes(' from public.')) return { rows: [] }
        return { rows: [{ id: 'new-id' }], rowCount: 1 }
      }),
      release: vi.fn(),
    }
    mockGetPool.mockReturnValue({ connect: vi.fn(async () => client) } as never)

    const result = await nativeOperationsPersistence.restoreBackup(admin, {
      version: 1,
      exportedAt: '2026-08-20T00:00:00.000Z',
      projects: [],
      activityTypes: [],
      timesheets: [],
      leaves: [],
      reminders: [
        { email: 'a@x.com', message: 'Existing', remind_at: '2026-08-20T10:00:00.000Z', done: false },
        { email: 'a@x.com', message: 'New', remind_at: '2026-08-21T10:00:00.000Z', done: false },
      ],
      globalReminders: [
        { message: 'Global', remind_at: '2026-08-20T10:00:00.000Z' },
        { message: 'New Global', remind_at: '2026-08-21T10:00:00.000Z' },
      ],
    })
    expect(result.error).toBeNull()
    expect(result.created.reminders).toBe(1)
    expect(result.created.globalReminders).toBe(1)
    expect(result.skipped).toBe(2)
  })
})

describe('native repository getGroupedReportTotals (Phase 4.5)', () => {
  it('aggregates by the requested groupBy in a single SQL query', async () => {
    mockQuery.mockResolvedValueOnce([
      { label: 'Alpha', hours: 4, entries: 1 },
      { label: 'Beta', hours: 6, entries: 1 },
    ])
    const result = await nativeReportingPersistence.getGroupedReportTotals(admin, { from: '2026-01-01', to: '2026-01-31' }, 'project')
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
    const result = await nativeReportingPersistence.getGroupedReportTotals(user, { projectId: 'p1', from: '2026-01-01' }, 'user')
    expect(result).toEqual([])
    const params = mockQuery.mock.calls[0][1]
    expect(params).toContain(user.id) // scope
    expect(params).toContain('p1')
    expect(params).toContain('2026-01-01')
  })
})

describe('native repository batch validation reads (F08)', () => {
  it('getTimesheetsByIds fetches rows using ANY($1::uuid[]) with actor scoping', async () => {
    const firstId = '11111111-1111-4111-8111-111111111111'
    const secondId = '22222222-2222-4222-8222-222222222222'
    mockQuery.mockResolvedValueOnce([
      {
        id: firstId,
        user_id: 'user-1',
        project_id: 'p-1',
        activity_type_id: 'a-1',
        log_date: '2026-01-01',
        hours_worked: 4,
        work_done: 'Test',
        created_at: '2026-01-01T00:00:00Z',
        project_name: 'P1',
        user_email: 'u@x.com',
        activity_type_name: 'Dev',
      },
    ])

    const rows = await nativeTimesheetPersistence.getByIds(user, [firstId, secondId])
    expect(rows.length).toBe(1)
    expect(rows[0].id).toBe(firstId)

    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('t.id = ANY($1::uuid[])')
    expect(sql).toContain('t.user_id = $2')
    expect(mockQuery.mock.calls[0][1]).toEqual([[firstId, secondId], user.id])
  })

  it('sumHoursForUserDates performs a single set-based unnest query and maps totals', async () => {
    mockQuery.mockResolvedValueOnce([
      { user_id: 'user-1', log_date: '2026-01-01', total: 8 },
      { user_id: 'user-1', log_date: '2026-01-02', total: 6.5 },
    ])

    const totals = await nativeTimesheetPersistence.sumHoursForUserDates(admin, [
      { userId: 'user-1', logDate: '2026-01-01' },
      { userId: 'user-1', logDate: '2026-01-02' },
      { userId: 'user-1', logDate: '2026-01-03' },
    ])

    expect(totals.get('user-1:2026-01-01')).toBe(8)
    expect(totals.get('user-1:2026-01-02')).toBe(6.5)
    expect(totals.get('user-1:2026-01-03')).toBe(0)

    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('unnest($1::uuid[])')
    expect(sql).toContain('unnest($2::date[])')
    expect(sql).toContain('with ordinality')
  })

  describe('atomic creates return row (T21.2)', () => {
    it('createProject returns inserted project via RETURNING', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'p-1', name: 'Alpha', so_number: 'SO-101', telegram_no: 4, created_at: '2026-09-01' },
      ])

      const res = await nativeReferencePersistence.createProject(admin, 'Alpha', { soNumber: 'SO-101', telegramNo: 4 })
      expect(res.error).toBeNull()
      expect(res.data).toEqual({ id: 'p-1', name: 'Alpha', so_number: 'SO-101', telegram_no: 4, created_at: '2026-09-01' })

      const [sql, params] = mockQuery.mock.calls[0]
      expect(sql).toContain('insert into public.projects (name, so_number, telegram_no)')
      expect(sql).toContain('returning id, name, so_number, telegram_no, created_at::text as created_at')
      expect(params).toEqual(['Alpha', 'SO-101', 4])
    })

    it('createProject denies regular user with error', async () => {
      const res = await nativeReferencePersistence.createProject(user, 'Alpha')
      expect(res.data).toBeNull()
      expect(res.error).toBe('You do not have permission to perform this action.')
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('createActivityType returns inserted activity type via RETURNING', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'a-1', name: 'Design', is_active: true, telegram_no: 2, created_at: '2026-09-01' },
      ])

      const res = await nativeReferencePersistence.createActivityType(admin, 'Design', { telegramNo: 2 })
      expect(res.error).toBeNull()
      expect(res.data).toEqual({ id: 'a-1', name: 'Design', is_active: true, telegram_no: 2, created_at: '2026-09-01' })

      const [sql, params] = mockQuery.mock.calls[0]
      expect(sql).toContain('insert into public.activity_types (name, telegram_no)')
      expect(sql).toContain('returning id, name, is_active, telegram_no, created_at::text as created_at')
      expect(params).toEqual(['Design', 2])
    })

    it('addTitle returns upserted title via RETURNING', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 't-1', name: 'Staff Engineer', hierarchy_role: 'manager', created_at: '2026-09-01' },
      ])

      const res = await nativeReferencePersistence.addTitle(admin, 'Staff Engineer', 'manager')
      expect(res.error).toBeNull()
      expect(res.data).toEqual({ id: 't-1', name: 'Staff Engineer', hierarchy_role: 'manager', created_at: '2026-09-01' })

      const [sql, params] = mockQuery.mock.calls[0]
      expect(sql).toContain('insert into public.titles (name, hierarchy_role)')
      expect(sql).toContain('on conflict (name) do update set hierarchy_role = excluded.hierarchy_role')
      expect(sql).toContain('returning id, name, hierarchy_role, created_at::text as created_at')
      expect(params).toEqual(['Staff Engineer', 'manager'])
    })

    it('createGlobalReminder returns inserted reminder via RETURNING', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'g-1', message: 'Meeting at 5', remind_at: '2026-09-01T17:00:00Z', created_at: '2026-09-01T16:00:00Z' },
      ])

      const res = await nativeLeaveReminderPersistence.createGlobalReminder(admin, {
        message: 'Meeting at 5',
        remindAt: '2026-09-01T17:00:00Z',
      })
      expect(res.error).toBeNull()
      expect(res.data?.id).toBe('g-1')

      const [sql, params] = mockQuery.mock.calls[0]
      expect(sql).toContain('insert into public.global_reminders (message, remind_at)')
      expect(sql).toContain('returning id, message, remind_at::text as remind_at, created_at::text as created_at')
      expect(params).toEqual(['Meeting at 5', '2026-09-01T17:00:00Z'])
    })
  })
})

describe('native restoreBackup (email case + ON CONFLICT target)', () => {
  const admin: Actor = { id: 'admin-1', email: 'admin@x.com', role: 'admin', permission_role: 'admin', hierarchy_role: 'user', isActive: true }

  // Build a fake pooled client keyed by SQL predicate so we can drive the
  // multi-statement transaction with deterministic fixtures.
  function clientWith(results: Record<string, unknown>) {
    const calls: string[] = []
    return {
      calls,
      obj: {
        query: async (sql: string) => {
          calls.push(sql)
          if (/^begin/i.test(sql)) return { rows: [] }
          if (/^lock table/i.test(sql)) return { rows: [] }
          if (/select id, name from public\.projects/.test(sql)) return { rows: [{ id: 'p1', name: 'Alpha' }] }
          if (/select id, name from public\.activity_types/.test(sql)) return { rows: [{ id: 'a1', name: 'Dev' }] }
          if (/select id, lower\(email\) as email from public\.profiles/.test(sql)) {
            return { rows: [{ id: 'u1', email: 'user@example.com' }] }
          }
          if (/select user_id, log_date, project_id/.test(sql)) return { rows: [] }
          if (/select user_id, message, remind_at/.test(sql)) return { rows: [] }
          if (/select message, remind_at::text from public\.global_reminders/.test(sql)) return { rows: [] }
          if (/insert into public\.projects/.test(sql)) return { rows: [], rowCount: 1 }
          if (/insert into public\.activity_types/.test(sql)) return { rows: [], rowCount: 1 }
          if (/insert into public\.leaves/.test(sql)) return { rows: [], rowCount: results.leavesInserted ?? 0 }
          if (/insert into public\.reminders/.test(sql)) return { rows: [], rowCount: results.remindersInserted ?? 0 }
          if (/insert into public\.global_reminders/.test(sql)) return { rows: [], rowCount: 1 }
          if (/insert into public\.timesheets/.test(sql)) return { rows: [], rowCount: 1 }
          if (/^commit/i.test(sql)) return { rows: [] }
          return { rows: [] }
        },
        release: () => {},
      },
    }
  }

  it('matches uppercase emails in leaves and reminders against lowercased profiles', async () => {
    const { obj, calls } = clientWith({ leavesInserted: 1, remindersInserted: 1 })
    mockGetPool.mockReturnValue({ connect: async () => obj } as never)

    const result = await nativeOperationsPersistence.restoreBackup(admin, {
      version: 1,
      exportedAt: '2099-01-01T00:00:00.000Z',
      projects: [],
      activityTypes: [],
      timesheets: [],
      leaves: [{ email: 'User@Example.COM', leave_date: '2099-01-01', reason: 'Leave' }],
      reminders: [{ email: 'USER@example.com', message: 'Remind me', remind_at: '2099-01-01T10:00:00Z', done: false }],
      globalReminders: [],
    })

    expect(result.error).toBeNull()
    expect(result.created.leaves).toBe(1)
    expect(result.created.reminders).toBe(1)
    expect(result.skipped).toBe(0)

    // Confirm the leave insert targeted (user_id, leave_date) — not bare
    // `on conflict do nothing`.
    const leaveInsert = calls.find((s) => /insert into public\.leaves/.test(s))
    expect(leaveInsert).toContain('on conflict (user_id, leave_date) do nothing')
    expect(leaveInsert).not.toMatch(/on conflict do nothing\s*$/m)
  })
})
