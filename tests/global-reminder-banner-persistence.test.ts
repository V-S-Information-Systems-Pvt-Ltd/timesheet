import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Actor } from '@/lib/db/types'
import type { BackupPayload, GlobalReminder } from '@/app/types'
import { mapGlobalReminderDto } from '@/lib/api/v1/contracts'

const { query, getPool, from, rpc } = vi.hoisted(() => ({
  query: vi.fn(), getPool: vi.fn(), from: vi.fn(), rpc: vi.fn(),
}))
vi.mock('@/lib/db/pool', () => ({ query, getPool }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }))
vi.mock('@/lib/supabase/bearer', () => ({ getMobileSupabaseClient: () => null }))
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: () => ({ from, rpc }) }))

import { nativeLeaveReminderPersistence as native } from '@/lib/db/native/leave-reminders'
import { supabaseLeaveReminderPersistence as supabase } from '@/lib/db/supabase/leave-reminders'
import { nativeOperationsPersistence as nativeOps } from '@/lib/db/native/operations'
import { supabaseOperationsPersistence as supabaseOps } from '@/lib/db/supabase/operations'

const admin: Actor = { id: 'admin', email: 'admin@example.com', role: 'admin', permission_role: 'admin', hierarchy_role: 'user', isActive: true }
const reminder: GlobalReminder = { id: 'g1', message: 'Payroll', remind_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', display_as_banner: true }
const backup = (globalReminders: BackupPayload['globalReminders']): BackupPayload => ({
  version: 1, exportedAt: reminder.created_at, projects: [], activityTypes: [], timesheets: [], leaves: [], reminders: [], globalReminders,
})

beforeEach(() => vi.resetAllMocks())

describe('global reminder banner persistence parity', () => {
  it.each([true, undefined])('native inserts and returns mode %s', async displayAsBanner => {
    query.mockResolvedValue([{ ...reminder, display_as_banner: displayAsBanner ?? false }])
    const result = await native.createGlobalReminder(admin, { message: reminder.message, remindAt: reminder.remind_at, displayAsBanner })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('display_as_banner'), [reminder.message, reminder.remind_at, displayAsBanner ?? false])
    expect(result.data?.display_as_banner).toBe(displayAsBanner ?? false)
  })

  it.each([true, undefined])('Supabase inserts and returns mode %s', async displayAsBanner => {
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { ...reminder, display_as_banner: displayAsBanner ?? false }, error: null }) }) })
    from.mockReturnValue({ insert })
    const result = await supabase.createGlobalReminder(admin, { message: reminder.message, remindAt: reminder.remind_at, displayAsBanner })
    expect(insert).toHaveBeenCalledWith({ message: reminder.message, remind_at: reminder.remind_at, display_as_banner: displayAsBanner ?? false })
    expect(result.data?.display_as_banner).toBe(displayAsBanner ?? false)
  })

  it('native due queries retain due/dismissal scoping and the new field', async () => {
    query.mockResolvedValue([reminder])
    expect(await native.listDueGlobalReminders(admin)).toEqual([reminder])
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/gr\.display_as_banner[\s\S]*gr\.remind_at <= now\(\)[\s\S]*not exists[\s\S]*d\.user_id = \$1/), [admin.id])
  })

  it('Supabase due queries retain due filtering and per-user dismissal', async () => {
    const lte = vi.fn().mockReturnValue({ order: async () => ({ data: [reminder, { ...reminder, id: 'dismissed' }], error: null }) })
    const eq = vi.fn().mockResolvedValue({ data: [{ reminder_id: 'dismissed' }], error: null })
    from.mockImplementation(table => ({ select: () => table === 'global_reminders' ? { lte } : { eq } }))
    expect(await supabase.listDueGlobalReminders(admin)).toEqual([reminder])
    expect(lte).toHaveBeenCalledWith('remind_at', expect.any(String))
    expect(eq).toHaveBeenCalledWith('user_id', admin.id)
  })

  it('maps banner mode to the shared DTO and defaults older rows to tiles', () => {
    expect(mapGlobalReminderDto(reminder).display_as_banner).toBe(true)
    expect(mapGlobalReminderDto({ ...reminder, display_as_banner: undefined }).display_as_banner).toBe(false)
  })

  it('exports the preference through both application backup adapters', async () => {
    query.mockImplementation(async sql => sql.includes('from public.global_reminders') ? [reminder] : [])
    expect((await nativeOps.exportBackup(admin)).payload?.globalReminders).toEqual([{ message: reminder.message, remind_at: reminder.remind_at, display_as_banner: true }])
    const selections: string[] = []
    from.mockImplementation(table => {
      const chain = {
        select: (columns: string) => { if (table === 'global_reminders') selections.push(columns); return chain },
        order: () => chain,
        limit: () => Promise.resolve({ data: table === 'global_reminders' ? [reminder] : [], error: null }),
        range: () => Promise.resolve({ data: [], error: null }),
      }
      return chain
    })
    expect((await supabaseOps.exportBackup(admin)).payload?.globalReminders).toEqual([{ message: reminder.message, remind_at: reminder.remind_at, display_as_banner: true }])
    expect(selections).toEqual(['message, remind_at, display_as_banner'])
  })

  it('native restore distinguishes presentation, binds every value, and is repeatable', async () => {
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

  it('Supabase restore passes validated preferences and legacy defaults to the transaction RPC', async () => {
    rpc.mockResolvedValue({ data: { skipped: 0 }, error: null })
    const payload = backup([{ message: 'Banner', remind_at: reminder.remind_at, display_as_banner: true }, { message: 'Legacy', remind_at: reminder.remind_at }])
    expect((await supabaseOps.restoreBackup(admin, payload)).error).toBeNull()
    expect(rpc).toHaveBeenCalledWith('restore_backup_tx', { p_payload: { ...payload, globalReminders: [{ ...payload.globalReminders[0] }, { ...payload.globalReminders[1], display_as_banner: false }] } })
  })

  it('adds backend defaults and retains the transactional restore security contract', () => {
    const nativeSql = readFileSync('db/migrations/0041_global_reminder_banner.sql', 'utf8')
    const sql = readFileSync('supabase/migrations/20261009000000_global_reminder_banner.sql', 'utf8')
    for (const migration of [nativeSql, sql]) expect(migration).toContain('add column display_as_banner boolean not null default false')
    expect(sql).toContain("and display_as_banner = coalesce((v_elem->>'display_as_banner')::boolean, false)")
    expect(sql).toContain('insert into public.global_reminders (message, remind_at, display_as_banner)')
    expect(sql).toContain('security definer\nset search_path = public, pg_temp')
    expect(sql).toContain('lock table public.projects, public.activity_types, public.timesheets, public.leaves, public.reminders, public.global_reminders in exclusive mode')
    expect(sql).toContain('revoke all on function public.restore_backup_tx(jsonb) from public, anon, authenticated;')
    expect(sql).toContain('grant execute on function public.restore_backup_tx(jsonb) to service_role;')
    expect(sql).toContain('alter function public.restore_backup_tx(jsonb) owner to postgres;')
  })
})
