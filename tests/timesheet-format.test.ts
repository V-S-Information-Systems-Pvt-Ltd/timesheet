import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTimesheetBearingRead, timesheetFormatResponse } from '@/lib/timesheet-format'

afterEach(() => vi.unstubAllEnvs())
describe('timesheet format compatibility', () => {
  it('only activates through the server-owned deployment flag', async () => {
    const old = new Request('http://localhost/api/v1/timesheets', { headers: { authorization: 'Bearer old' } })
    vi.stubEnv('TIMESHEET_CLASSIFICATION_V2', 'false')
    expect(timesheetFormatResponse(old)).toBeNull()
    vi.stubEnv('TIMESHEET_CLASSIFICATION_V2', 'true')
    const rejected = timesheetFormatResponse(old)!
    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toMatchObject({ data: null, error: { code: 'CLIENT_UPDATE_REQUIRED' } })
    expect(timesheetFormatResponse(new Request(old.url, { headers: { 'X-Timesheet-Format': '2' } }))).toBeNull()
  })
  it('exempts cookie-authenticated browser requests after activation', () => {
    vi.stubEnv('TIMESHEET_CLASSIFICATION_V2', 'true')
    expect(timesheetFormatResponse(new Request('http://localhost/api/v1/timesheets/duplicate', { method: 'POST', headers: { cookie: 'session=browser' } }))).toBeNull()
  })
  it.each(['timesheets', 'timesheets/last', 'dashboard', 'admin/users/user-1/timesheets', 'admin/backup', 'reports/export'])('covers timesheet-bearing %s reads', path => {
    expect(isTimesheetBearingRead(new Request(`http://localhost/api/v1/${path}`))).toBe(true)
  })
  it.each(['auth/me', 'auth/login', 'config', 'idempotency-tickets', 'reference', 'reports'])('leaves format-independent %s endpoints usable', path => {
    expect(isTimesheetBearingRead(new Request(`http://localhost/api/v1/${path}`))).toBe(false)
  })
})
