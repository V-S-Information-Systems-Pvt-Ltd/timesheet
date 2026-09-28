import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActor, gate, verify, findSession, reserveRateLimit, release, operations, people, reference, timesheets } = vi.hoisted(() => ({
  getActor: vi.fn(), gate: vi.fn(), verify: vi.fn(), findSession: vi.fn(), reserveRateLimit: vi.fn(), release: vi.fn(),
  operations: { exportBackup: vi.fn(), deleteUserTimesheets: vi.fn(), importTimesheets: vi.fn(), writeAuditLog: vi.fn() },
  people: { listProfiles: vi.fn() },
  reference: { listProjects: vi.fn(), listAllActivityTypes: vi.fn() },
  timesheets: { sumHoursForUserDates: vi.fn() },
}))

vi.mock('@/lib/auth', async () => ({ ...await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth'), getActor }))
vi.mock('@/lib/db/write-gate', () => ({ writeGateResponse: gate }))
vi.mock('@/lib/auth/mobile-tokens', () => ({ verifyMobileAccessToken: verify, isLegacyMobileToken: vi.fn(async () => false) }))
vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { findSessionAndActorById: findSession } }))
vi.mock('@/lib/rate-limit', () => ({ reserveRateLimit }))
vi.mock('@/lib/db/operations', () => ({
  operationsDeps: () => ({ persistence: operations, maintenance: {}, clock: () => new Date(), backend: 'native' }),
}))
vi.mock('@/lib/db/people', () => ({ peoplePersistence: people }))
vi.mock('@/lib/db/reference', () => ({ referencePersistence: reference }))
vi.mock('@/lib/db/timesheets', () => ({ timesheetPersistence: timesheets }))

import { GET as exportBackup } from '@/app/api/v1/admin/backup/route'
import { POST as importTimesheets } from '@/app/api/v1/admin/timesheets/import/route'
import { DELETE as deleteUserTimesheets } from '@/app/api/v1/admin/users/[id]/timesheets/route'

const admin = {
  id: 'admin-1', email: 'admin@example.com', isActive: true,
  role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'manager' as const,
}
const user = { ...admin, id: 'user-1', email: 'user@example.com', role: 'user' as const, permission_role: 'user' as const }
const row = {
  email: 'person@example.com', logDate: '2026-09-26', project: 'Astra',
  activityType: 'Development', hours: '8', workDone: 'Implemented route migration',
}
const payload = {
  version: 1, exportedAt: '2026-09-26T00:00:00.000Z', projects: [], activityTypes: [],
  timesheets: [], leaves: [], reminders: [], globalReminders: [],
}

function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      host: 'localhost:3000', origin: 'http://localhost:3000', cookie: 'session=1',
      'content-type': 'application/json', ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  getActor.mockResolvedValue(admin)
  gate.mockResolvedValue(null)
  release.mockResolvedValue(undefined)
  reserveRateLimit.mockResolvedValue({ ok: true, release })
  operations.exportBackup.mockResolvedValue({ payload, error: null })
  operations.deleteUserTimesheets.mockResolvedValue({ error: null })
  operations.importTimesheets.mockResolvedValue({ imported: 1, skipped: 0, error: null })
  operations.writeAuditLog.mockResolvedValue({ error: null })
  people.listProfiles.mockResolvedValue([{ id: 'person-1', email: row.email }])
  reference.listProjects.mockResolvedValue([{ id: 'project-1', name: row.project }])
  reference.listAllActivityTypes.mockResolvedValue([{ id: 'type-1', name: row.activityType }])
  timesheets.sumHoursForUserDates.mockResolvedValue(new Map())
})

describe('browser admin operations routes', () => {
  it('exports backups through an admin read even while writes are fenced', async () => {
    gate.mockResolvedValue({ status: 503, body: { error: 'Writers fenced.' } })
    const response = await exportBackup(request('/api/v1/admin/backup'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: payload, error: null })
    expect(gate).not.toHaveBeenCalled()
  })

  it('imports validated rows with one reservation and preserves result counts', async () => {
    const response = await importTimesheets(request('/api/v1/admin/timesheets/import', 'POST', { rows: [row] }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { imported: 1, skipped: 0, errors: [] }, error: null,
    })
    expect(reserveRateLimit).toHaveBeenCalledWith('daily-import', `import:${admin.id}`)
    expect(operations.importTimesheets).toHaveBeenCalledWith(admin, [{
      userId: 'person-1', projectId: 'project-1', activityTypeId: 'type-1',
      hoursWorked: 8, workDone: row.workDone, logDate: row.logDate,
    }])
    expect(release).not.toHaveBeenCalled()
  })

  it('releases the import reservation when reference resolution throws', async () => {
    people.listProfiles.mockRejectedValue(new Error('Directory unavailable'))
    const response = await importTimesheets(request('/api/v1/admin/timesheets/import', 'POST', { rows: [row] }))
    expect(response.status).toBe(500)
    expect(release).toHaveBeenCalledTimes(1)
    expect(operations.importTimesheets).not.toHaveBeenCalled()
  })

  it('deletes one user timesheet set without deleting the user', async () => {
    const response = await deleteUserTimesheets(
      request('/api/v1/admin/users/person-1/timesheets', 'DELETE'),
      { params: Promise.resolve({ id: 'person-1' }) }
    )
    expect(response.status).toBe(200)
    expect(operations.deleteUserTimesheets).toHaveBeenCalledWith(admin, 'person-1')
  })

  it('rejects ordinary users, malformed bodies, unsafe origins and fenced writes', async () => {
    getActor.mockResolvedValue(user)
    expect((await exportBackup(request('/api/v1/admin/backup'))).status).toBe(403)
    expect((await importTimesheets(request('/api/v1/admin/timesheets/import', 'POST', { rows: [row] }))).status).toBe(403)
    expect(reserveRateLimit).not.toHaveBeenCalled()

    getActor.mockResolvedValue(admin)
    expect((await importTimesheets(request('/api/v1/admin/timesheets/import', 'POST', {
      rows: [{ ...row, injected: true }],
    }))).status).toBe(400)
    expect((await importTimesheets(request('/api/v1/admin/timesheets/import', 'POST', { rows: [row] }, {
      origin: 'https://evil.example',
    }))).status).toBe(403)

    gate.mockRejectedValue(new Error('Gate unavailable'))
    const fenced = await deleteUserTimesheets(
      request('/api/v1/admin/users/person-1/timesheets', 'DELETE'),
      { params: Promise.resolve({ id: 'person-1' }) }
    )
    expect(fenced.status).toBe(503)
    expect(fenced.headers.get('retry-after')).toBe('60')
  })
})
