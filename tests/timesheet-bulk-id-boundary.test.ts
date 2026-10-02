import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '@/lib/db/types'

const { query, createClient, getAdminClient } = vi.hoisted(() => ({
  query: vi.fn(), createClient: vi.fn(), getAdminClient: vi.fn(),
}))
vi.mock('@/lib/db/pool', () => ({ query }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient }))
vi.mock('@/lib/supabase/bearer', () => ({ getMobileSupabaseClient: () => null }))

import { nativeTimesheetPersistence } from '@/lib/db/native/timesheets'
import { supabaseTimesheetPersistence } from '@/lib/db/supabase/timesheets'
import { bulkUpdateTimesheetsDomain } from '@/lib/domain/timesheets'

const canonical = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const user: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'user@example.com', role: 'user', permission_role: 'user', hierarchy_role: 'user', isActive: true }
const spellings = [canonical, canonical.toUpperCase(), canonical.replaceAll('-', ''),
  'a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11', '{a0eebc99-9c0b4ef8-bb6d6bb9-bd380a11}']

function mockSupabase(data: Array<Record<string, unknown>> = [], error: { message: string } | null = null) {
  const result = { data, error }
  const chain = {
    select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
  const client = { from: vi.fn(() => chain) }
  createClient.mockResolvedValue(client)
  return { chain, client }
}

beforeEach(() => { vi.resetAllMocks(); query.mockResolvedValue([]) })

describe('timesheet batch lookup PostgreSQL UUID input boundary', () => {
  it.each(spellings)('normalizes supported spelling %s in both adapter queries', async (id) => {
    const { chain } = mockSupabase()
    await nativeTimesheetPersistence.getByIds(user, [id, 'not-a-uuid'])
    await supabaseTimesheetPersistence.getByIds(user, [id, 'not-a-uuid'])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ANY($1::uuid[])'), [[canonical], user.id])
    expect(chain.in).toHaveBeenCalledWith('id', [canonical])
    expect(chain.eq).toHaveBeenCalledWith('user_id', user.id)
    expect(getAdminClient).not.toHaveBeenCalled()
  })

  it.each([[], ['not-a-uuid'], [`${canonical}-`], [`{${canonical}`], [` ${canonical}`]].map((ids) => ({ ids })))('does not query or initialize a client for all-invalid inputs $ids', async ({ ids }) => {
    await expect(nativeTimesheetPersistence.getByIds(user, ids)).resolves.toEqual([])
    await expect(supabaseTimesheetPersistence.getByIds(user, ids)).resolves.toEqual([])
    expect(query).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
    expect(getAdminClient).not.toHaveBeenCalled()
  })

  it.each([
    ['admin', false], ['co', false], ['pm', true], ['user', true],
  ] as const)('preserves %s actor lookup scope', async (permissionRole, scoped) => {
    const actor = { ...user, role: permissionRole, permission_role: permissionRole }
    const { chain } = mockSupabase()
    await nativeTimesheetPersistence.getByIds(actor, [canonical])
    await supabaseTimesheetPersistence.getByIds(actor, [canonical])
    const [sql, parameters] = query.mock.calls[0]
    expect(sql.includes('t.user_id = $2')).toBe(scoped)
    expect(parameters).toEqual(scoped ? [[canonical], actor.id] : [[canonical]])
    if (scoped) expect(chain.eq).toHaveBeenCalledWith('user_id', actor.id)
    else expect(chain.eq).not.toHaveBeenCalled()
  })

  it.each(['native', 'supabase'] as const)('keeps a valid bulk edit when an invalid ID accompanies it through the %s adapter', async (backend) => {
    const stored = {
      id: canonical, user_id: user.id, project_id: '22222222-2222-4222-8222-222222222222',
      activity_type_id: '33333333-3333-4333-8333-333333333333', log_date: '2026-10-01',
      hours_worked: 2, work_done: 'Original work', created_at: '',
      project_name: null, user_email: null, activity_type_name: null,
    }
    mockSupabase([stored])
    query.mockImplementation(async (_sql, parameters) => {
      if (parameters[0].includes('not-a-uuid')) throw new Error('Invalid UUID database input')
      return [stored]
    })
    const adapter = backend === 'native' ? nativeTimesheetPersistence : supabaseTimesheetPersistence
    const bulkUpdate = vi.fn(async () => ({ updated: 1, rowErrors: [], error: null }))
    const reserve = vi.fn(async () => ({ ok: true as const, reservation: { release: vi.fn(async () => {}) } }))
    const entry = { id: canonical, projectId: stored.project_id, activityTypeId: stored.activity_type_id, logDate: stored.log_date, workDone: 'Updated work', hoursWorked: 4 }
    const result = await bulkUpdateTimesheetsDomain(user, [entry, { ...entry, id: 'not-a-uuid' }], {
      persistence: {
        ...adapter, getBackfillWindow: async () => ({ mode: 'days', windowDays: 7, extraDays: 0 }),
        sumHoursForUserDates: async () => new Map([[`${user.id}:${stored.log_date}`, 2]]), bulkUpdate,
      }, clock: () => stored.log_date, writeBudget: { reserve },
    })
    expect(result).toEqual({ ok: true, data: { updated: 1, errors: ['Entry not-a-uuid: not found'] } })
    expect(bulkUpdate).toHaveBeenCalledWith(user, [expect.objectContaining({ id: canonical, hoursWorked: 4 })])
    expect(reserve).toHaveBeenCalledTimes(1)
  })

  it('continues propagating genuine backend query errors for valid IDs', async () => {
    query.mockRejectedValue(new Error('Native query unavailable'))
    mockSupabase([], { message: 'Provider unavailable' })
    await expect(nativeTimesheetPersistence.getByIds(user, [canonical])).rejects.toThrow('Native query unavailable')
    await expect(supabaseTimesheetPersistence.getByIds(user, [canonical])).rejects.toThrow('Provider unavailable')
  })
})
