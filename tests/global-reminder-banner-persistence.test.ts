import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '@/lib/db/types'
import type { BackupPayload, GlobalReminder } from '@/app/types'
import { mapGlobalReminderDto } from '@/lib/api/v1/contracts'

const { query, getPool } = vi.hoisted(() => ({
  query: vi.fn(), getPool: vi.fn(),
}))
vi.mock('@/lib/db/pool', () => ({ query, getPool }))

import { nativeLeaveReminderPersistence as native } from '@/lib/db/native/leave-reminders'
import { nativeOperationsPersistence as nativeOps } from '@/lib/db/native/operations'

const admin: Actor = { id: 'admin', email: 'admin@example.com', role: 'admin', permission_role: 'admin', hierarchy_role: 'user', isActive: true }
const reminder: GlobalReminder = { id: 'g1', message: 'Payroll', remind_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', display_as_banner: true }
const backup = (globalReminders: BackupPayload['globalReminders']): BackupPayload => ({
  version: 1, exportedAt: reminder.created_at, projects: [], activityTypes: [], timesheets: [], leaves: [], reminders: [], globalReminders,
})

beforeEach(() => vi.resetAllMocks())

describe('global reminder banner persistence', () => {
  it.each([true, undefined])('native inserts and returns mode %s', async displayAsBanner => {
    query.mockResolvedValue([{ ...reminder, display_as_banner: displayAsBanner ?? false }])
    const result = await native.createGlobalReminder(admin, { message: reminder.message, remindAt: reminder.remind_at, displayAsBanner })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('display_as_banner'), [reminder.message, reminder.remind_at, displayAsBanner ?? false])
    expect(result.data?.display_as_banner).toBe(displayAsBanner ?? false)
  })

  it('native due queries retain due/dismissal scoping and the new field', async () => {
    query.mockResolvedValue([reminder])
    expect(await native.listDueGlobalReminders(admin)).toEqual([reminder])
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/gr\.display_as_banner[\s\S]*gr\.remind_at <= now\(\)[\s\S]*not exists[\s\S]*d\.user_id = \$1/), [admin.id])
  })

  it('maps banner mode to the shared DTO and defaults older rows to tiles', () => {
    expect(mapGlobalReminderDto(reminder).display_as_banner).toBe(true)
    expect(mapGlobalReminderDto({ ...reminder, display_as_banner: undefined }).display_as_banner).toBe(false)
  })

  it('native restore distinguishes presentation, binds every value, and is repeatable', async () => {
    query.mockResolvedValue([])
    const rows: Array<{ message: string; remind_at: string; display_as_banner: boolean }> = []
    const sqlQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('select message, remind_at::text')) return { rows: [...rows] }
      if (sql.startsWith('insert into public.global_reminders')) {
        expect(sql).toContain('values ($1, $2::timestamptz, $3::boolean), ($4, $5::timestamptz, $6::boolean)')
        expect(params).toEqual([reminder.message, reminder.remind_at, true, reminder.message, reminder.remind_at, false])
        for (let i = 0; i < params!.length; i += 3) rows.push({ message: String(params![i]), remind_at: String(params![i + 1]), display_as_banner: Boolean(params![i + 2]) })
      }
      return { rows: [] }
    })
    getPool.mockReturnValue({ connect: async () => ({ query: sqlQuery, release: vi.fn() }) })
    const payload = backup([
      { message: reminder.message, remind_at: reminder.remind_at, display_as_banner: true },
      { message: reminder.message, remind_at: reminder.remind_at },
      { message: reminder.message, remind_at: reminder.remind_at, display_as_banner: false },
    ])
    const first = await nativeOps.restoreBackup(admin, payload)
    expect(first.error).toBeNull()
    expect(first.created.globalReminders).toBe(2)
    expect(first.skipped).toBe(1)
    const again = await nativeOps.restoreBackup(admin, payload)
    expect(again.error).toBeNull()
    expect(again.created.globalReminders).toBe(0)
    expect(again.skipped).toBe(3)
  })

})
