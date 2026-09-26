// tests/data-client-native.test.ts
// Coverage for the backend-neutral HTTP data facade in lib/data/client.ts:
// verifies the URL path/method/body each method produces. There is no
// backend selection, so these come from the cookie-authenticated compatibility
// routes and the versioned timesheet resource.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { DataClient } from '../lib/data/client'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

async function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

describe('backend-neutral data client', () => {
  let dataClient: DataClient

  beforeEach(async () => {
    mockFetch.mockReset()
    vi.resetModules()
    const mod = await import('../lib/data/client')
    dataClient = mod.dataClient
  })

  it('getProjects GETs /api/v1/reference and maps the project DTO', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({
      data: {
        projects: [{
          id: 'p1',
          name: 'Alpha',
          so_number: 'SO-1',
          telegram_no: 7,
          created_at: '2026-09-26T00:00:00.000Z',
        }],
      },
      error: null,
    }))
    expect(await dataClient.getProjects()).toEqual({
      data: [{
        id: 'p1',
        name: 'Alpha',
        so_number: 'SO-1',
        telegram_no: 7,
        created_at: '2026-09-26T00:00:00.000Z',
      }],
      error: null,
    })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reference',
      expect.objectContaining({ credentials: 'same-origin' })
    )
  })

  it('bulk edit preserves mixed outcomes and all-failed wording', async () => {
    const entries = [{ id: 't1', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Work', logDate: '2026-09-26' }]
    mockFetch.mockResolvedValueOnce(await jsonResponse({ data: { updated: 1, errors: ['Entry t2: not found'] }, error: null }))
    expect(await dataClient.bulkUpdateTimesheets(entries)).toEqual({ error: null, updated: 1, errors: ['Entry t2: not found'] })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/timesheets/batch-update', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ entries }),
    }))
    mockFetch.mockResolvedValueOnce(await jsonResponse({ data: { updated: 0, errors: ['Entry t1: not found'] }, error: null }))
    expect(await dataClient.bulkUpdateTimesheets(entries)).toEqual({ error: 'All edits failed.', updated: 0, errors: ['Entry t1: not found'] })
  })

  it('project mutations send one field at a time, preserve clears and encode IDs', async () => {
    mockFetch.mockImplementation(async () => jsonResponse({ data: { success: true }, error: null }))
    expect(await dataClient.addProject(' Alpha ')).toEqual({ error: null })
    expect(mockFetch).toHaveBeenLastCalledWith('http://localhost/api/v1/admin/projects', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ name: ' Alpha ' }),
    }))
    const id = 'p/1 ?'
    const path = `http://localhost/api/v1/admin/projects/${encodeURIComponent(id)}`
    await dataClient.renameProject(id, 'Beta')
    expect(mockFetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Beta' }) }))
    await dataClient.setProjectSO(id, '')
    expect(mockFetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ soNumber: '' }) }))
    await dataClient.setProjectTelegramNo(id, 7)
    expect(mockFetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ telegramNo: 7 }) }))
    await dataClient.setProjectTelegramNo(id, null)
    expect(mockFetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ telegramNo: null }) }))
    await dataClient.deleteProject(id)
    expect(mockFetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ method: 'DELETE' }))
  })

  it('project mutations preserve server errors and remain separate submissions', async () => {
    mockFetch.mockResolvedValueOnce(await jsonResponse({ data: null, error: { code: 'BAD_REQUEST', message: 'Cannot delete: referenced.' } }, 400))
    expect(await dataClient.deleteProject('p1')).toMatchObject({ error: 'Cannot delete: referenced.' })
    mockFetch.mockImplementation(async () => jsonResponse({ data: { success: true }, error: null }))
    await Promise.all([dataClient.addProject('Alpha'), dataClient.addProject('Alpha')])
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('user administration sends narrow operation contracts and encoded IDs', async () => {
    mockFetch.mockImplementation(async () => jsonResponse({ data: { success: true }, error: null }))
    const input = {
      email: 'new@example.com', password: 'Test-password-123', name: 'New User', department: '', title: '',
      permissionRole: 'user' as const, hierarchyRole: 'user' as const, isActive: false, managerId: null,
    }
    expect(await dataClient.addUser(input)).toEqual({ error: null })
    expect(mockFetch).toHaveBeenLastCalledWith('http://localhost/api/v1/admin/users', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify(input),
    }))
    const id = 'u/1 ?'
    const path = `http://localhost/api/v1/admin/users/${encodeURIComponent(id)}`
    await dataClient.toggleUserStatus(id)
    expect(mockFetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ operation: 'toggle-status' }) }))
    await dataClient.updateUserRoles(id, 'pm', 'engineer')
    expect(mockFetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ body: JSON.stringify({ operation: 'roles', permissionRole: 'pm', hierarchyRole: 'engineer' }) }))
    await dataClient.updateUserName(id, 'Name')
    expect(mockFetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ body: JSON.stringify({ operation: 'name', name: 'Name' }) }))
    await dataClient.updateUserDepartment(id, '')
    expect(mockFetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ body: JSON.stringify({ operation: 'department', department: '' }) }))
    await dataClient.setUserManager(id, null)
    expect(mockFetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ body: JSON.stringify({ operation: 'manager', managerId: null }) }))
    const hierarchy = { managerId: null, title: 'Manager', hierarchyRole: 'manager' as const }
    await dataClient.updateUserHierarchy(id, hierarchy)
    expect(mockFetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ body: JSON.stringify({ ...hierarchy, operation: 'hierarchy' }) }))
  })

  it('user mutations surface errors and do not coalesce status toggles', async () => {
    mockFetch.mockResolvedValueOnce(await jsonResponse({ data: null, error: { code: 'VALIDATION_ERROR', message: 'You cannot change your own roles.' } }, 400))
    expect(await dataClient.updateUserRoles('self', 'admin', 'manager')).toMatchObject({ error: 'You cannot change your own roles.' })
    mockFetch.mockImplementation(async () => jsonResponse({ data: { success: true }, error: null }))
    await Promise.all([dataClient.toggleUserStatus('u1'), dataClient.toggleUserStatus('u1')])
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('bulk edit surfaces transport and malformed-success failures', async () => {
    mockFetch.mockResolvedValueOnce(await jsonResponse({ data: null, error: { code: 'RATE_LIMITED', message: 'Budget exceeded.' } }, 429))
    expect(await dataClient.bulkUpdateTimesheets([])).toEqual({ error: 'Budget exceeded.' })
    mockFetch.mockResolvedValueOnce(await jsonResponse({ data: { updated: '1', errors: [] }, error: null }))
    expect(await dataClient.bulkUpdateTimesheets([])).toEqual({ error: 'The server returned an invalid response.' })
  })

  it('bulk edit does not coalesce separate submissions', async () => {
    mockFetch.mockImplementation(async () => jsonResponse({ data: { updated: 1 }, error: null }))
    await Promise.all([dataClient.bulkUpdateTimesheets([]), dataClient.bulkUpdateTimesheets([])])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('getProjects normalizes a bare { data } response to error: null', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({
      data: {
        projects: [{
          id: 'p1',
          name: 'Alpha',
          so_number: null,
          telegram_no: null,
          created_at: '2026-09-26T00:00:00.000Z',
        }],
      },
    }))
    expect(await dataClient.getProjects()).toEqual({
      data: [{
        id: 'p1',
        name: 'Alpha',
        so_number: null,
        telegram_no: null,
        created_at: '2026-09-26T00:00:00.000Z',
      }],
      error: null,
    })
  })

  it('getTimesheets builds from/to/limit query params on the versioned resource', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: { rows: [], count: 0 }, error: null }))
    await dataClient.getTimesheets({ from: 0, to: 49, limit: 50 })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/timesheets?from=0&to=49&limit=50',
      expect.any(Object)
    )
    await dataClient.getTimesheets({})
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/timesheets', expect.any(Object))
  })

  it('getTimesheets maps the flat wire DTO back to the row shape consumers use', async () => {
    mockFetch.mockResolvedValue(
      await jsonResponse({
        data: {
          rows: [
            {
              id: 't1',
              user_id: 'u1',
              user_email: 'u@example.com',
              project_id: 'p1',
              project_name: 'Alpha',
              activity_type_id: 'a1',
              activity_name: 'Development',
              log_date: '2026-09-12',
              hours_worked: 7.5,
              work_done: 'Work',
              created_at: '2026-09-12T10:00:00.000Z',
            },
          ],
          count: 1,
        },
        error: null,
      })
    )
    const result = await dataClient.getTimesheets()
    expect(result.count).toBe(1)
    expect(result.error).toBeNull()
    expect(result.data?.[0]).toMatchObject({
      id: 't1',
      hours_worked: 7.5,
      projects: { name: 'Alpha' },
      activity_types: { name: 'Development' },
      profiles: { email: 'u@example.com' },
    })
  })

  it('getTimesheets surfaces transport errors without throwing', async () => {
    mockFetch.mockResolvedValue(
      await jsonResponse({ data: null, error: { code: 'FORBIDDEN', message: 'Nope.' } }, 403)
    )
    const result = await dataClient.getTimesheets()
    expect(result.data).toBeNull()
    expect(result.error).toBe('Nope.')
  })

  it('timesheet mutations use versioned browser routes and preserve validation details', async () => {
    const input = {
      projectId: 'p1',
      activityTypeId: 'a1',
      hoursWorked: 4,
      workDone: 'Work',
      logDate: '2026-09-26',
    }

    mockFetch.mockResolvedValueOnce(await jsonResponse({ data: { success: true }, error: null }, 201))
    expect(await dataClient.createTimesheet(input)).toEqual({ error: null })
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://localhost/api/v1/timesheets',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(input),
      })
    )

    mockFetch.mockResolvedValueOnce(await jsonResponse({
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Project is required.',
        fieldErrors: { projectId: ['Project is required.'] },
      },
    }, 400))
    expect(await dataClient.createTimesheet({ ...input, projectId: '' })).toEqual({
      error: 'Project is required.',
      code: 'VALIDATION_ERROR',
      fieldErrors: { projectId: ['Project is required.'] },
    })

    mockFetch.mockResolvedValueOnce(await jsonResponse({ data: { success: true }, error: null }, 201))
    await dataClient.logYesterday({
      projectId: 'p1',
      activityTypeId: 'a1',
      hoursWorked: 4,
      workDone: 'Yesterday',
      userId: 'u2',
    })
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://localhost/api/v1/timesheets/yesterday',
      expect.objectContaining({ method: 'POST' })
    )

    mockFetch.mockResolvedValueOnce(await jsonResponse({
      data: null,
      error: { code: 'NOT_FOUND', message: 'Timesheet entry not found.' },
    }, 404))
    expect((await dataClient.updateTimesheet('missing', input)).error).toBe('Entry not found.')

    for (const call of [
      () => dataClient.deleteTimesheet('t1'),
      () => dataClient.deleteLastTimesheet(),
      () => dataClient.duplicateTimesheet('t1'),
    ]) {
      mockFetch.mockResolvedValueOnce(await jsonResponse({ data: { success: true }, error: null }))
      expect(await call()).toEqual({ error: null })
    }
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/timesheets/t1',
      expect.objectContaining({ method: 'DELETE' })
    )
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/timesheets/last',
      expect.objectContaining({ method: 'DELETE' })
    )
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/timesheets/t1/duplicate',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('profile + backfill + activity-type getters', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({
      data: [{
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        role: 'manager',
        permissionRole: 'user',
        hierarchyRole: 'manager',
        department: 'Engineering',
        title: 'Lead',
        managerId: null,
        isActive: true,
        dashboardLayout: [{ id: 'entries', enabled: true }],
        adminLayout: null,
        mobileLayout: [{ id: 'timesheets', enabled: true }],
        createdAt: '2026-09-26T00:00:00.000Z',
      }],
      error: null,
    }))
    expect(await dataClient.getAllUsers()).toEqual({
      data: [{
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        role: 'manager',
        permission_role: 'user',
        hierarchy_role: 'manager',
        department: 'Engineering',
        title: 'Lead',
        manager_id: null,
        is_active: true,
        dashboard_layout: [{ id: 'entries', enabled: true }],
        admin_layout: null,
        mobile_layout: [{ id: 'timesheets', enabled: true }],
        created_at: '2026-09-26T00:00:00.000Z',
      }],
      error: null,
    })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/people', expect.any(Object))
    await dataClient.getProfile()
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/profile', expect.any(Object))
    await dataClient.getBackfillWindow()
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/settings/backfill', expect.any(Object))
  })

  it('does not merge distinct simultaneous timesheet submissions', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: { success: true }, error: null }, 201))
    const input = {
      projectId: 'p1', activityTypeId: 'a1', hoursWorked: 1,
      workDone: 'Separate submissions', logDate: '2026-09-26',
    }
    await Promise.all([dataClient.createTimesheet(input), dataClient.createTimesheet(input)])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('activity types (all vs active)', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({
      data: {
        activityTypes: [{
          id: 'a1',
          name: 'Development',
          is_active: true,
          telegram_no: 101,
          created_at: '2026-09-26T00:00:00.000Z',
        }],
      },
      error: null,
    }))
    expect(await dataClient.getActivityTypes()).toEqual({
      data: [{
        id: 'a1',
        name: 'Development',
        is_active: true,
        telegram_no: 101,
        created_at: '2026-09-26T00:00:00.000Z',
      }],
      error: null,
    })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/reference', expect.any(Object))

    mockFetch.mockResolvedValue(await jsonResponse({
      data: {
        activityTypes: [{
          id: 'a2',
          name: 'Retired',
          is_active: false,
          telegram_no: null,
          created_at: '2026-09-25T00:00:00.000Z',
        }],
      },
      error: null,
    }))
    expect(await dataClient.getAllActivityTypes()).toEqual({
      data: [{
        id: 'a2',
        name: 'Retired',
        is_active: false,
        telegram_no: null,
        created_at: '2026-09-25T00:00:00.000Z',
      }],
      error: null,
    })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/reference?all=1', expect.any(Object))
  })

  it('leaves: read (with filters), insert, delete', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [], error: null }))
    await dataClient.getLeaves({ userId: 'u1', from: '2026-01-01', to: '2026-02-01' })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/leaves?userId=u1&from=2026-01-01&to=2026-02-01',
      expect.any(Object)
    )
    await dataClient.insertLeaves([{ userId: 'u1', leaveDate: 'd', reason: 'r' }])
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/leaves',
      expect.objectContaining({ method: 'POST' })
    )
    await dataClient.deleteLeave('l1')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/leaves/l1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('reminders: read, insert, update, delete', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [], error: null }))
    await dataClient.getReminders()
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/reminders', expect.any(Object))
    await dataClient.insertReminder({ userId: 'u1', message: 'm', remindAt: 'd' })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reminders',
      expect.objectContaining({ method: 'POST' })
    )
    await dataClient.updateReminder('r1', true)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reminders/r1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ done: true }) })
    )
    await dataClient.deleteReminder('r1')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reminders/r1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('global reminders: due vs all', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [], error: null }))
    await dataClient.getDueGlobalReminders()
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/reminders/global', expect.any(Object))
    await dataClient.getGlobalReminders()
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reminders/global?all=1',
      expect.any(Object)
    )
  })

  it('getReportTotals queries /api/data/reports with query params', async () => {
    mockFetch.mockResolvedValue(
      await jsonResponse({ data: { totalHours: 10, totalEntries: 2, byGroup: [] }, error: null })
    )
    const res = await dataClient.getReportTotals({ project: 'p1', from: '2026-08-01', to: '2026-08-31', groupBy: 'user' })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reports?project=p1&from=2026-08-01&to=2026-08-31&groupBy=user',
      expect.any(Object)
    )
    expect(res.data?.totalHours).toBe(10)
  })
})
