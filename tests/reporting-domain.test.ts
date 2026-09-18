// tests/reporting-domain.test.ts
// Focused coverage for the reporting application module: shared query
// validation/defaulting, the totals reduction, server-side export scope
// enforcement, and the provider-neutral CSV page read.

import { describe, expect, it, vi } from 'vitest'

import {
  REPORT_GROUP_BYS,
  getReportTotals,
  listReportCsvPage,
  resolveReportExportScope,
  resolveReportTotalsQuery,
} from '@/lib/domain/reporting'
import type { ReportingPersistence } from '@/lib/domain/reporting-port'
import type { Actor } from '@/lib/db/repository'

const admin: Actor = {
  id: 'admin-1',
  email: 'admin@vsis.lk',
  role: 'admin',
  permission_role: 'admin',
  hierarchy_role: 'user',
  isActive: true,
}
const leader: Actor = {
  id: 'lead-1',
  email: 'lead@vsis.lk',
  role: 'team_lead',
  permission_role: 'user',
  hierarchy_role: 'team_lead',
  isActive: true,
}
const user: Actor = {
  id: 'user-1',
  email: 'user@vsis.lk',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'engineer',
  isActive: true,
}

function makeDeps(overrides: Partial<ReportingPersistence> = {}) {
  const persistence: ReportingPersistence = {
    getGroupedReportTotals: vi.fn().mockResolvedValue([]),
    listTimesheets: vi.fn().mockResolvedValue({ rows: [], count: 0 }),
    ...overrides,
  }
  return { persistence, clock: () => '2026-08-31' }
}

describe('resolveReportTotalsQuery', () => {
  it('exposes the canonical grouping axes', () => {
    expect(REPORT_GROUP_BYS).toEqual(['user', 'project', 'activity'])
  })

  it('defaults groupBy and the upper date bound', () => {
    const resolved = resolveReportTotalsQuery(
      { from: '2026-08-01' },
      { defaultGroupBy: 'project', clock: () => '2026-08-31' }
    )
    expect(resolved).toEqual({
      ok: true,
      filters: { projectId: undefined, userId: undefined, from: '2026-08-01', to: '2026-08-31' },
      groupBy: 'project',
    })
  })

  it('rejects an unknown groupBy', () => {
    const resolved = resolveReportTotalsQuery(
      { groupBy: 'bogus' },
      { defaultGroupBy: 'user', clock: () => '2026-08-31' }
    )
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.message).toContain('groupBy')
  })

  it('rejects malformed dates with a field-specific message', () => {
    const badFrom = resolveReportTotalsQuery(
      { from: 'not-a-date' },
      { defaultGroupBy: 'user', clock: () => '2026-08-31' }
    )
    expect(badFrom.ok).toBe(false)
    if (!badFrom.ok) expect(badFrom.message).toContain('from')

    const badTo = resolveReportTotalsQuery(
      { to: '2026-99-99' },
      { defaultGroupBy: 'user', clock: () => '2026-08-31' }
    )
    expect(badTo.ok).toBe(false)
    if (!badTo.ok) expect(badTo.message).toContain('to')
  })

  it('passes project and user filters through unchanged', () => {
    const resolved = resolveReportTotalsQuery(
      { projectId: 'p1', userId: 'u9', from: '2026-01-01', to: '2026-01-31', groupBy: 'activity' },
      { defaultGroupBy: 'user', clock: () => '2026-08-31' }
    )
    expect(resolved).toEqual({
      ok: true,
      filters: { projectId: 'p1', userId: 'u9', from: '2026-01-01', to: '2026-01-31' },
      groupBy: 'activity',
    })
  })
})

describe('getReportTotals', () => {
  it('reduces the provider buckets into totals and forwards the scope', async () => {
    const deps = makeDeps({
      getGroupedReportTotals: vi.fn().mockResolvedValue([
        { label: 'Alpha', hours: 4, entries: 1 },
        { label: 'Beta', hours: '6' as unknown as number, entries: 2 },
      ]),
    })

    const totals = await getReportTotals(
      user,
      { projectId: 'p1', from: '2026-01-01', to: '2026-01-31' },
      'project',
      deps
    )

    expect(totals.totalHours).toBe(10)
    expect(totals.totalEntries).toBe(3)
    expect(deps.persistence.getGroupedReportTotals).toHaveBeenCalledWith(
      user,
      { projectId: 'p1', from: '2026-01-01', to: '2026-01-31' },
      'project'
    )
  })

  it('returns zeroed totals for an empty bucket list', async () => {
    const totals = await getReportTotals(admin, {}, 'user', makeDeps())
    expect(totals).toEqual({ totalHours: 0, totalEntries: 0, byGroup: [] })
  })
})

describe('resolveReportExportScope', () => {
  it('pins an ordinary user to their own rows even when another user is requested', () => {
    const scope = resolveReportExportScope(
      user,
      { project: 'p1', user: 'someone-else', from: '2026-08-01', to: '2026-08-31' },
      makeDeps()
    )
    expect(scope.filters).toEqual({
      userId: 'user-1',
      projectId: 'p1',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    })
    expect(scope.filename).toBe('timesheets_20260801_20260831.csv')
  })

  it('lets a leader keep an explicit user filter', () => {
    const scope = resolveReportExportScope(
      leader,
      { user: 'u-user', from: '2026-08-01', to: '2026-08-31' },
      makeDeps()
    )
    expect(scope.filters.userId).toBe('u-user')
  })

  it('lets an admin export all users and normalizes the "all" sentinels', () => {
    const scope = resolveReportExportScope(
      admin,
      { project: 'all', user: 'all' },
      makeDeps()
    )
    expect(scope.filters).toEqual({
      userId: undefined,
      projectId: undefined,
      dateFrom: undefined,
      dateTo: '2026-08-31',
    })
    expect(scope.filename).toBe('timesheets_all_20260831.csv')
  })
})

describe('listReportCsvPage', () => {
  it('forwards the scoped filters and page window to persistence', async () => {
    const deps = makeDeps()
    const scope = { userId: 'user-1', projectId: 'p1', dateFrom: '2026-08-01', dateTo: '2026-08-31' }

    await listReportCsvPage(user, scope, { from: 0, to: 499, includeCount: false }, deps)

    expect(deps.persistence.listTimesheets).toHaveBeenCalledWith(user, {
      userId: 'user-1',
      projectId: 'p1',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      from: 0,
      to: 499,
      includeCount: false,
    })
  })
})
