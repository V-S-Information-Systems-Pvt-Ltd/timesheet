// tests/operations-domain.test.ts
// Slice 09: the operations coordinator owns backup/restore, import, reset,
// audit and scheduled cleanup orchestration. These tests pin delegation,
// authorization, atomic single-call restore, failure reporting and bounded,
// redacted logging.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteUserTimesheetsData,
  exportBackupData,
  importTimesheetRows,
  resetOperationalData,
  restoreBackupFromJson,
  runScheduledMaintenance,
  type MaintenanceAuthorization,
  type OperationsDomainDeps,
} from '../lib/domain/operations'
import type { Actor } from '../lib/db/repository'
import type { OperationsAuditEntry } from '../lib/domain/operations-port'
import type { BackupPayload } from '../app/types'
import { logger } from '../lib/logger'

const SUPER_ADMIN_EMAIL = 'super@x.com'

const admin: Actor = {
  id: 'a1',
  email: 'admin@x.com',
  role: 'admin',
  permission_role: 'admin',
  hierarchy_role: 'user',
  isActive: true,
}

const superAdmin: Actor = { ...admin, email: SUPER_ADMIN_EMAIL }
const regularUser: Actor = {
  id: 'u1',
  email: 'user@x.com',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'user',
  isActive: true,
}

const backupPayload = (): BackupPayload => ({
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  projects: [{ name: 'Internal', so_number: null, telegram_no: 1000 }],
  activityTypes: [{ name: 'R&D', is_active: true, telegram_no: null }],
  timesheets: [
    {
      email: 'a@x.com',
      log_date: '2026-01-02',
      project: 'Internal',
      activity_type: 'R&D',
      hours_worked: 8,
      work_done: 'TOP-SECRET-BODY',
    },
  ],
  leaves: [],
  reminders: [],
  globalReminders: [],
})

const createdCounts = {
  projects: 1,
  activityTypes: 1,
  timesheets: 1,
  leaves: 0,
  reminders: 0,
  globalReminders: 0,
}

function buildDeps() {
  const mocks = {
    exportBackup: vi.fn(async () => ({ payload: backupPayload(), error: null as string | null })),
    restoreBackup: vi.fn(async (_actor: Actor, _payload: BackupPayload) => ({
      created: { ...createdCounts },
      skipped: 1,
      error: null as string | null,
    })),
    importTimesheets: vi.fn(async () => ({ imported: 2, skipped: 0, error: null as string | null })),
    deleteUserTimesheets: vi.fn(async () => ({ error: null as string | null })),
    resetTimesheets: vi.fn(async () => ({ error: null as string | null })),
    resetActivityData: vi.fn(async () => ({ error: null as string | null })),
    resetAllData: vi.fn(async () => ({ error: null as string | null })),
    writeAuditLog: vi.fn(async (_actor: Actor, _entry: OperationsAuditEntry) => ({ error: null as string | null })),
    cleanupExpiredSessions: vi.fn(async () => 3),
    cleanupRateLimits: vi.fn(async () => 4),
    cleanupIdempotencyKeys: vi.fn(async () => 5),
  }

  const deps: OperationsDomainDeps = {
    persistence: {
      exportBackup: mocks.exportBackup,
      restoreBackup: mocks.restoreBackup,
      importTimesheets: mocks.importTimesheets,
      deleteUserTimesheets: mocks.deleteUserTimesheets,
      resetTimesheets: mocks.resetTimesheets,
      resetActivityData: mocks.resetActivityData,
      resetAllData: mocks.resetAllData,
      writeAuditLog: mocks.writeAuditLog,
    },
    maintenance: {
      cleanupExpiredSessions: mocks.cleanupExpiredSessions,
      cleanupRateLimits: mocks.cleanupRateLimits,
      cleanupIdempotencyKeys: mocks.cleanupIdempotencyKeys,
    },
    clock: () => new Date('2026-01-01T00:00:00.000Z'),
    backend: 'native',
  }
  return { deps, mocks }
}

beforeEach(() => {
  vi.stubEnv('SUPER_ADMIN_EMAIL', SUPER_ADMIN_EMAIL)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('operations coordinator: backup export', () => {
  it('delegates to the port and returns the payload/error unchanged', async () => {
    const { deps, mocks } = buildDeps()
    const result = await exportBackupData(admin, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.payload?.timesheets[0].work_done).toBe('TOP-SECRET-BODY')
    expect(mocks.exportBackup).toHaveBeenCalledTimes(1)
    expect(mocks.exportBackup).toHaveBeenCalledWith(admin)
  })

  it('rejects non-admin actors before touching the port', async () => {
    const { deps, mocks } = buildDeps()
    const result = await exportBackupData(regularUser, deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('FORBIDDEN')
    expect(mocks.exportBackup).not.toHaveBeenCalled()
  })

  it('logs operation/backend/result metadata but never the backup body', async () => {
    const { deps } = buildDeps()
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    await exportBackupData(admin, deps)
    expect(infoSpy).toHaveBeenCalledTimes(1)
    const meta = infoSpy.mock.calls[0][1] as Record<string, unknown>
    expect(meta.operation).toBe('backup.export')
    expect(meta.backend).toBe('native')
    expect(meta.result).toBe('success')
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain('TOP-SECRET-BODY')
  })
})

describe('operations coordinator: restore', () => {
  it('parses, validates and calls the provider restore exactly once (atomic)', async () => {
    const { deps, mocks } = buildDeps()
    const json = JSON.stringify(backupPayload())
    const result = await restoreBackupFromJson(admin, json, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.created.timesheets).toBe(1)
    expect(result.data.skipped).toBe(1)
    expect(result.data.auditRecorded).toBe(true)
    expect(mocks.restoreBackup).toHaveBeenCalledTimes(1)
    expect(mocks.restoreBackup.mock.calls[0][0]).toBe(admin)
    // The validated/normalized payload is what the provider receives.
    expect(mocks.restoreBackup.mock.calls[0][1].timesheets).toHaveLength(1)
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1)
    expect(mocks.writeAuditLog.mock.calls[0][1]).toMatchObject({ action: 'backup.restore' })
  })

  it('rejects invalid JSON and unsupported versions without calling the provider', async () => {
    const { deps, mocks } = buildDeps()

    const badJson = await restoreBackupFromJson(admin, '{not json', deps)
    expect(badJson.ok).toBe(false)
    if (!badJson.ok) expect(badJson.error.code).toBe('VALIDATION_ERROR')
    expect(mocks.restoreBackup).not.toHaveBeenCalled()

    const badVersion = await restoreBackupFromJson(
      admin,
      JSON.stringify({ ...backupPayload(), version: 99 }),
      deps
    )
    expect(badVersion.ok).toBe(false)
    if (!badVersion.ok) expect(badVersion.error.message).toContain('Unsupported backup version')
    expect(mocks.restoreBackup).not.toHaveBeenCalled()
  })

  it('reports no fabricated success counts and skips audit when the provider fails', async () => {
    const { deps, mocks } = buildDeps()
    // Simulate a provider that returns partial-looking counts alongside an error.
    mocks.restoreBackup.mockResolvedValueOnce({
      created: { projects: 5, activityTypes: 5, timesheets: 5, leaves: 5, reminders: 5, globalReminders: 5 },
      skipped: 42,
      error: 'Database constraint violation during restore',
    })
    const result = await restoreBackupFromJson(admin, JSON.stringify(backupPayload()), deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('STORAGE_ERROR')
    expect(result.error.message).toContain('constraint')
    expect('data' in result).toBe(false)
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('rejects non-admin actors before calling the provider', async () => {
    const { deps, mocks } = buildDeps()
    const result = await restoreBackupFromJson(regularUser, JSON.stringify(backupPayload()), deps)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
    expect(mocks.restoreBackup).not.toHaveBeenCalled()
  })
})

describe('operations coordinator: import and admin lifecycle', () => {
  it('delegates import and audits every successful write', async () => {
    const { deps, mocks } = buildDeps()
    const result = await importTimesheetRows(admin, [], deps)
    expect(result.ok).toBe(true)
    expect(mocks.importTimesheets).toHaveBeenCalledWith(admin, [])
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1)
    expect(mocks.writeAuditLog.mock.calls[0][1]).toMatchObject({ action: 'timesheets.import' })
  })

  it('does not audit a failed import', async () => {
    const { deps, mocks } = buildDeps()
    mocks.importTimesheets.mockResolvedValueOnce({ imported: 0, skipped: 3, error: 'write failed' })
    const result = await importTimesheetRows(admin, [], deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.error).toBe('write failed')
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('deletes a user\'s timesheets for an admin and rejects a regular user', async () => {
    const { deps, mocks } = buildDeps()
    expect((await deleteUserTimesheetsData(admin, 'u2', deps)).ok).toBe(true)
    expect(mocks.deleteUserTimesheets).toHaveBeenCalledWith(admin, 'u2')

    const denied = await deleteUserTimesheetsData(regularUser, 'u2', deps)
    expect(denied.ok).toBe(false)
    expect(mocks.deleteUserTimesheets).toHaveBeenCalledTimes(1)
  })
})

describe('operations coordinator: super-admin reset', () => {
  it('dispatches each valid mode and audits the reset', async () => {
    const { deps, mocks } = buildDeps()
    expect((await resetOperationalData(superAdmin, 'timesheets', deps)).ok).toBe(true)
    expect((await resetOperationalData(superAdmin, 'activity', deps)).ok).toBe(true)
    expect((await resetOperationalData(superAdmin, 'all', deps)).ok).toBe(true)
    expect(mocks.resetTimesheets).toHaveBeenCalledTimes(1)
    expect(mocks.resetActivityData).toHaveBeenCalledTimes(1)
    expect(mocks.resetAllData).toHaveBeenCalledTimes(1)
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(3)
    expect(mocks.writeAuditLog.mock.calls[0][1]).toMatchObject({ action: 'database.reset', detail: { mode: 'timesheets' } })
  })

  it('rejects a non-super-admin admin and an unknown mode without dispatching', async () => {
    const { deps, mocks } = buildDeps()
    const denied = await resetOperationalData(admin, 'timesheets', deps)
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')

    const invalid = await resetOperationalData(superAdmin, 'everything', deps)
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.message).toBe('Invalid reset mode.')

    expect(mocks.resetTimesheets).not.toHaveBeenCalled()
    expect(mocks.resetActivityData).not.toHaveBeenCalled()
    expect(mocks.resetAllData).not.toHaveBeenCalled()
  })
})

describe('operations coordinator: scheduled maintenance', () => {
  it('refuses an ordinary-user authorization without running any cleanup', async () => {
    const { deps, mocks } = buildDeps()
    const result = await runScheduledMaintenance({ kind: 'user' } as unknown as MaintenanceAuthorization, deps)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
    expect(mocks.cleanupExpiredSessions).not.toHaveBeenCalled()
    expect(mocks.cleanupRateLimits).not.toHaveBeenCalled()
    expect(mocks.cleanupIdempotencyKeys).not.toHaveBeenCalled()
  })

  it('composes session, rate-limit and idempotency cleanup for the scheduled authorization', async () => {
    const { deps, mocks } = buildDeps()
    const result = await runScheduledMaintenance({ kind: 'scheduled' }, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({ cleanedSessions: 3, cleanedRateLimits: 4, cleanedIdempotencyKeys: 5 })
    expect(mocks.cleanupRateLimits).toHaveBeenCalledWith(new Date('2026-01-01T00:00:00.000Z'))
    expect(mocks.cleanupIdempotencyKeys).toHaveBeenCalledWith(97)
  })

  it('keeps rate-limit and idempotency failures non-fatal', async () => {
    const { deps, mocks } = buildDeps()
    mocks.cleanupRateLimits.mockRejectedValueOnce(new Error('rate-limit store down'))
    mocks.cleanupIdempotencyKeys.mockRejectedValueOnce(new Error('idempotency store down'))
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})

    const result = await runScheduledMaintenance({ kind: 'scheduled' }, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.cleanedSessions).toBe(3)
    expect(result.data.cleanedRateLimits).toBe(0)
    expect(result.data.cleanedIdempotencyKeys).toBe(0)
    expect(errorSpy).toHaveBeenCalledTimes(2)
  })
})
