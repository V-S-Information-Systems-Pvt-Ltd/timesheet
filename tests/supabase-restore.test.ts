// tests/supabase-restore.test.ts
// Tests for the Supabase transactional restore procedure restore_backup_tx.
// All writes are wrapped in an atomic database transaction.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { getAdminClient } from '@/lib/supabase/admin'
import { supabaseRepository } from '@/lib/db/supabase'
import type { BackupPayload } from '@/app/types'

class FakeBuilder {
  static inserts: Array<{ table: string; args: unknown[] }> = []
  constructor(private table: string) {}
  insert(...args: unknown[]) {
    FakeBuilder.inserts.push({ table: this.table, args })
    return this
  }
  select() {
    return this
  }
  then(resolve: (v: unknown) => void) {
    return Promise.resolve({ data: [{ id: '1' }], error: null }).then(resolve)
  }
}

const mockRpc = vi.fn()
const admin = {
  from: (table: string) => new FakeBuilder(table),
  rpc: mockRpc,
}

const adminActor = {
  id: 'a1',
  email: 'admin@x.com',
  role: 'admin' as const,
  permission_role: 'admin' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

const userActor = {
  id: 'u1',
  email: 'user@x.com',
  role: 'user' as const,
  permission_role: 'user' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

const payload = (): BackupPayload => ({
  version: 1,
  exportedAt: '2026-08-20T00:00:00.000Z',
  projects: [],
  activityTypes: [],
  timesheets: [],
  leaves: [{ email: 'a@x.com', leave_date: '2026-08-20', reason: 'sick' }],
  reminders: [],
  globalReminders: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAdminClient).mockReturnValue(admin as never)
  FakeBuilder.inserts.length = 0
})

describe('supabase restoreBackup transactional RPC', () => {
  it('rejects non-admin actor before calling RPC', async () => {
    const result = await supabaseRepository.restoreBackup(userActor, payload())
    expect(result.error).toBe('You do not have permission to perform this action.')
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('calls restore_backup_tx RPC and returns created/skipped counts on success', async () => {
    mockRpc.mockResolvedValue({
      data: {
        created: { projects: 1, activityTypes: 1, timesheets: 2, leaves: 1, reminders: 0, globalReminders: 0 },
        skipped: 1,
        error: null,
      },
      error: null,
    })

    const result = await supabaseRepository.restoreBackup(adminActor, payload())
    expect(mockRpc).toHaveBeenCalledWith('restore_backup_tx', expect.objectContaining({
      p_payload: expect.any(Object),
    }))
    expect(result.error).toBeNull()
    expect(result.created.projects).toBe(1)
    expect(result.created.timesheets).toBe(2)
    expect(result.created.leaves).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('rolls back and returns zeroed counts on RPC failure', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Database constraint violation during restore' },
    })

    const result = await supabaseRepository.restoreBackup(adminActor, payload())
    expect(result.error).toBe('Database constraint violation during restore')
    expect(result.created.projects).toBe(0)
    expect(result.created.timesheets).toBe(0)
    expect(result.created.leaves).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('sanitizes work_done before passing to restore_backup_tx RPC', async () => {
    const dirty = '<script>alert(1)</script>logged   <b>work</b>'
    const clean = 'logged work'

    const backup = payload()
    backup.timesheets.push({
      email: 'a@x.com',
      log_date: '2026-08-19',
      project: 'Alpha',
      activity_type: null,
      hours_worked: 8,
      work_done: dirty,
    })

    mockRpc.mockResolvedValue({
      data: {
        created: { projects: 0, activityTypes: 0, timesheets: 1, leaves: 0, reminders: 0, globalReminders: 0 },
        skipped: 0,
        error: null,
      },
      error: null,
    })

    const result = await supabaseRepository.restoreBackup(adminActor, backup)
    expect(result.error).toBeNull()
    expect(mockRpc).toHaveBeenCalledWith('restore_backup_tx', {
      p_payload: expect.objectContaining({
        timesheets: [
          expect.objectContaining({
            work_done: clean,
          }),
        ],
      }),
    })
  })
})

describe('supabase work_done sanitization on importTimesheets', () => {
  const dirty = '<script>x</script>logged   <b>work</b>'
  const clean = 'logged work'

  it('sanitizes work_done in importTimesheets inserts', async () => {
    const result = await supabaseRepository.importTimesheets(adminActor, [
      { userId: 'u1', projectId: 'p1', activityTypeId: null, hoursWorked: 1, workDone: dirty, logDate: '2026-01-01' },
    ])
    expect(result.error).toBeNull()
    const insert = FakeBuilder.inserts.find((i) => i.table === 'timesheets')
    expect(insert).toBeDefined()
    expect((insert!.args[0] as Array<{ work_done: string }>)[0].work_done).toBe(clean)
  })
})
