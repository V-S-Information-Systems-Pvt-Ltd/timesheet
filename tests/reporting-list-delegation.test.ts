import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor, TimesheetListOptions } from '@/lib/db/types'

const mocks = vi.hoisted(() => ({
  nativeList: vi.fn(),
}))

vi.mock('@/lib/db/pool', () => ({ query: vi.fn() }))

import { createNativeReportingPersistence } from '@/lib/db/native/reporting'

const nativeReportingPersistence = createNativeReportingPersistence(mocks.nativeList)

const actor: Actor = {
  id: 'leader-1', email: 'leader@example.test', role: 'team_lead',
  permission_role: 'user', hierarchy_role: 'team_lead', isActive: true,
}
const options: TimesheetListOptions = {
  userId: 'subordinate-1', projectId: 'project-1',
  dateFrom: '2026-01-01', dateTo: '2026-02-28',
  from: 500, to: 999, includeCount: false,
}

beforeEach(() => vi.resetAllMocks())

for (const [name, persistence, list] of [
  ['native', nativeReportingPersistence, mocks.nativeList],
] as const) {
  describe(`${name} report list delegation`, () => {
    it('passes actor, scope filters and pagination unchanged to the timesheet adapter', async () => {
      const result = { rows: [], count: 0 }
      list.mockResolvedValue(result)
      expect(await persistence.listTimesheets(actor, options)).toBe(result)
      expect(list).toHaveBeenCalledExactlyOnceWith(actor, options)
    })

    it('propagates read failures rather than returning a partial export', async () => {
      list.mockRejectedValue(new Error('Scoped read unavailable'))
      await expect(persistence.listTimesheets(actor, options)).rejects.toThrow('Scoped read unavailable')
    })
  })
}
