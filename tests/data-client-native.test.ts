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

  it('updates the signed-in profile through v1 without coalescing writes', async () => {
    mockFetch.mockImplementation(async () => jsonResponse({ data: { success: true }, error: null }))
    const input = { department: ' Engineering ', title: 'Systems Engineer' }
    expect(await dataClient.updateMyProfile(input)).toEqual({ error: null })
    expect(mockFetch).toHaveBeenLastCalledWith('http://localhost/api/v1/profile', expect.objectContaining({
      method: 'PATCH', credentials: 'same-origin', body: JSON.stringify(input),
    }))
    await Promise.all([dataClient.updateMyProfile(input), dataClient.updateMyProfile(input)])
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('surfaces self-profile validation failures', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'Changing hierarchy roles requires an administrator.' },
    }, 400))
    expect(await dataClient.updateMyProfile({ department: '', title: 'Manager' })).toMatchObject({
      error: 'Changing hierarchy roles requires an administrator.', code: 'VALIDATION_ERROR',
    })
  })

  it('uses strict v1 activity-type operations without coalescing writes', async () => {
    mockFetch.mockImplementation(async () => jsonResponse({ data: { success: true }, error: null }))
    expect(await dataClient.addActivityType('Review')).toEqual({ error: null })
    expect(await dataClient.renameActivityType('a/1', 'Architecture')).toEqual({ error: null })
    expect(await dataClient.setActivityTypeActive('a/1', false)).toEqual({ error: null })
    expect(await dataClient.setActivityTypeTelegramNo('a/1', null)).toEqual({ error: null })
    expect(mockFetch.mock.calls.map((call) => [call[0], (call[1] as RequestInit).method, (call[1] as RequestInit).body])).toEqual([
      ['http://localhost/api/v1/admin/activity-types', 'POST', JSON.stringify({ name: 'Review' })],
      ['http://localhost/api/v1/admin/activity-types/a%2F1', 'PATCH', JSON.stringify({ operation: 'rename', name: 'Architecture' })],
      ['http://localhost/api/v1/admin/activity-types/a%2F1', 'PATCH', JSON.stringify({ operation: 'active', isActive: false })],
      ['http://localhost/api/v1/admin/activity-types/a%2F1', 'PATCH', JSON.stringify({ operation: 'telegram', telegramNo: null })],
    ])
    await Promise.all([dataClient.setActivityTypeActive('a1', true), dataClient.setActivityTypeActive('a1', true)])
    expect(mockFetch).toHaveBeenCalledTimes(6)
  })

  it('loads titles through an isolated v1 reference mode', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({
      data: { projects: [], activityTypes: [], titles: ['Engineer', 'Manager'], titleItems: [] }, error: null,
    }))
    expect(await dataClient.getTitles()).toEqual({ data: ['Engineer', 'Manager'], error: null })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/reference?only=titles', expect.any(Object))
  })

  it('uses versioned global-reminder mutations as independent writes', async () => {
    mockFetch.mockImplementation(async () => jsonResponse({ data: { success: true }, error: null }))
    const input = { message: 'Submit sheets', remindAt: '2026-10-01T12:00:00.000Z' }
    expect(await dataClient.addGlobalReminder(input)).toEqual({ error: null })
    expect(await dataClient.deleteGlobalReminder('g/1')).toEqual({ error: null })
    expect(await dataClient.dismissGlobalReminder('g/1')).toEqual({ error: null })
    expect(mockFetch.mock.calls.map((call) => [call[0], (call[1] as RequestInit).method, (call[1] as RequestInit).body])).toEqual([
      ['http://localhost/api/v1/admin/global-reminders', 'POST', JSON.stringify(input)],
      ['http://localhost/api/v1/admin/global-reminders/g%2F1', 'DELETE', undefined],
      ['http://localhost/api/v1/reminders/global/g%2F1/dismiss', 'POST', undefined],
    ])
    await Promise.all([dataClient.dismissGlobalReminder('g1'), dataClient.dismissGlobalReminder('g1')])
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })

  it('uses the explicit web-layout, capability and backfill resources', async () => {
    const dashboard = { tiles: [{ id: 'entry-form' as const, enabled: true }] }
    const admin = { tiles: [{ id: 'settings' as const, enabled: true }] }
    mockFetch
      .mockResolvedValueOnce(await jsonResponse({ data: { dashboard, admin }, error: null }))
      .mockResolvedValueOnce(await jsonResponse({ data: { isSuperAdmin: true }, error: null }))
      .mockImplementation(async () => jsonResponse({ data: { success: true }, error: null }))
    expect(await dataClient.getDefaultLayouts()).toEqual({ data: { dashboard, admin }, error: null })
    expect(await dataClient.getCapabilities()).toEqual({ data: { isSuperAdmin: true }, error: null })
    expect(await dataClient.saveDashboardLayout(dashboard)).toEqual({})
    expect(await dataClient.saveAdminLayout(admin)).toEqual({})
    expect(await dataClient.setDefaultLayouts(dashboard, admin)).toEqual({})
    expect(await dataClient.setBackfillWindow({ mode: 'days', windowDays: 7, extraDays: 0 })).toEqual({ error: null })
    expect(mockFetch.mock.calls.map((call) => [call[0], (call[1] as RequestInit).method])).toEqual([
      ['http://localhost/api/v1/layout/web', undefined],
      ['http://localhost/api/v1/capabilities', undefined],
      ['http://localhost/api/v1/layout/web', 'PATCH'],
      ['http://localhost/api/v1/layout/web', 'PATCH'],
      ['http://localhost/api/v1/layout/web', 'PUT'],
      ['http://localhost/api/v1/admin/settings/backfill', 'PUT'],
    ])
  })

  it('reads, saves and resets workspace branding through v1', async () => {
    const branding = { appName: 'Astra', primaryColor: '#2255aa', logoUrl: 'https://example.com/logo.png?v=2' }
    mockFetch
      .mockResolvedValueOnce(await jsonResponse({ data: branding, error: null }))
      .mockImplementation(async () => jsonResponse({ data: { success: true }, error: null }))
    expect(await dataClient.getBranding()).toEqual({ data: branding, error: null })
    expect(await dataClient.saveBranding(branding)).toEqual({ error: null })
    expect(await dataClient.resetBranding()).toEqual({ error: null })
    expect(mockFetch.mock.calls.map((call) => [call[0], (call[1] as RequestInit).method, (call[1] as RequestInit).body])).toEqual([
      ['http://localhost/api/v1/admin/branding', undefined, undefined],
      ['http://localhost/api/v1/admin/branding', 'PUT', JSON.stringify(branding)],
      ['http://localhost/api/v1/admin/branding', 'PUT', JSON.stringify({ reset: true })],
    ])
  })

  it('uses versioned superadmin lifecycle resources', async () => {
    const domains = [{ id: 'd1', domain: 'example.com', auto_activate: false, created_at: '2026-09-26' }]
    const impact = {
      title: 'Engineer', currentHierarchyRole: 'engineer', proposedHierarchyRole: 'team_lead',
      affectedCount: 2, syncRequired: true,
    }
    mockFetch.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/whitelist')) return jsonResponse({ data: domains, error: null })
      if (url.includes('/titles/impact?')) return jsonResponse({ data: impact, error: null })
      return jsonResponse({ data: { success: true }, error: null })
    })

    expect(await dataClient.getWhitelistedDomains()).toEqual({ data: domains, error: null })
    expect(await dataClient.addWhitelistedDomain('example.com', true)).toEqual({ error: null })
    expect(await dataClient.toggleDomainAutoActivate('d/1', true)).toEqual({ error: null })
    expect(await dataClient.deleteWhitelistedDomain('d/1')).toEqual({ error: null })
    expect(await dataClient.addTitle('Architect')).toEqual({ error: null })
    expect(await dataClient.getTitleImpact('Engineer', 'team_lead')).toEqual({ data: impact, error: null })
    expect(await dataClient.reclassifyTitle('Engineer', 'team_lead', true)).toEqual({ error: null })
    expect(await dataClient.deleteTitle('Lead Architect')).toEqual({ error: null })
    expect(await dataClient.resetDatabase('activity')).toEqual({ error: null })
    expect(await dataClient.deleteUserPermanently('u/1')).toEqual({ error: null })
    expect(await dataClient.deleteActivityType('a/1')).toEqual({ error: null })

    expect(mockFetch.mock.calls.map((call) => [call[0], (call[1] as RequestInit).method])).toEqual([
      ['http://localhost/api/v1/admin/superadmin/whitelist', undefined],
      ['http://localhost/api/v1/admin/superadmin/whitelist', 'POST'],
      ['http://localhost/api/v1/admin/superadmin/whitelist/d%2F1', 'PATCH'],
      ['http://localhost/api/v1/admin/superadmin/whitelist/d%2F1', 'DELETE'],
      ['http://localhost/api/v1/admin/titles', 'POST'],
      ['http://localhost/api/v1/admin/titles/impact?name=Engineer&proposedRole=team_lead', undefined],
      ['http://localhost/api/v1/admin/titles', 'PATCH'],
      ['http://localhost/api/v1/admin/titles?name=Lead%20Architect', 'DELETE'],
      ['http://localhost/api/v1/admin/superadmin/reset', 'POST'],
      ['http://localhost/api/v1/admin/superadmin/users/u%2F1', 'DELETE'],
      ['http://localhost/api/v1/admin/activity-types/a%2F1', 'DELETE'],
    ])
  })

  it('uses shared client methods for admin import, backup and user-timesheet deletion', async () => {
    const row = {
      email: 'person@example.com', logDate: '2026-09-26', project: 'Astra',
      activityType: 'Development', hours: '8', workDone: 'Implemented transports',
    }
    const payload = { version: 1, exportedAt: '2026-09-26T00:00:00.000Z' }
    const created = {
      projects: 1, activityTypes: 1, timesheets: 1, leaves: 0, reminders: 0, globalReminders: 0,
    }
    mockFetch.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/admin/backup')) return jsonResponse({ data: payload, error: null })
      if (url.endsWith('/admin/backup/restore')) return jsonResponse({ success: true, created, skipped: 2 })
      if (url.endsWith('/admin/timesheets/import')) {
        return jsonResponse({ data: { imported: 1, skipped: 0, errors: [] }, error: null })
      }
      return jsonResponse({ data: { success: true }, error: null })
    })

    expect(await dataClient.exportBackup()).toEqual({ payload, error: null })
    expect(await dataClient.restoreBackup('{"version":1}')).toEqual({ created, skipped: 2, error: null })
    expect(await dataClient.importTimesheets([row])).toEqual({ imported: 1, skipped: 0, errors: [], error: null })
    expect(await dataClient.deleteUserTimesheets('u/1')).toEqual({ error: null })
    expect(mockFetch.mock.calls.map((call) => [call[0], (call[1] as RequestInit).method, (call[1] as RequestInit).body])).toEqual([
      ['http://localhost/api/v1/admin/backup', undefined, undefined],
      ['http://localhost/api/v1/admin/backup/restore', 'POST', '{"version":1}'],
      ['http://localhost/api/v1/admin/timesheets/import', 'POST', JSON.stringify({ rows: [row] })],
      ['http://localhost/api/v1/admin/users/u%2F1/timesheets', 'DELETE', undefined],
    ])
  })

  it('reports an uncertain restore outcome when the long-running request times out', async () => {
    const timeout = new Error('Request timed out after 120000ms.')
    timeout.name = 'TimeoutError'
    mockFetch.mockRejectedValueOnce(timeout)

    const result = await dataClient.restoreBackup('{"version":1}')
    expect(result.error).toContain('server may already have completed the restore')
    expect(result.error).toContain('refresh and verify')
    expect(result.error).toContain('before retrying')
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
