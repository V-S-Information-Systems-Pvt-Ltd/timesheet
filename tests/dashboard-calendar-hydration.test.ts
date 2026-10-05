import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import TimeEntryForm, { useBrowserToday } from '@/app/dashboard/time-entry-form'
import { todayISO } from '@/lib/dates'
import { backfillMinDate, type BackfillSettings } from '@/lib/validation'
import DashboardClient from '@/app/dashboard/dashboard-client'
import LeavePanel from '@/app/dashboard/leave-panel'
import { ThemeProvider } from '@/app/components/theme-provider'
import { DEFAULT_ADMIN_LAYOUT, DEFAULT_DASHBOARD_LAYOUT } from '@/app/constants'
import type { DashboardSeed } from '@/lib/dashboard-seed'
import type { Timesheet, User } from '@/app/types'

const phase = vi.hoisted(() => ({ value: 'server' as 'server' | 'hydration' | 'local' }))
// Exercise the actual snapshot callbacks. Bare server rendering always uses the
// server snapshot; the local phase models React's post-hydration store check.
vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>()
  return { ...react, useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown, getServerSnapshot: () => unknown) => {
    const server = getServerSnapshot()
    return phase.value === 'local' && typeof server === 'string' ? getSnapshot() : server
  } }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
}))

function CalendarForm({ settings }: { settings: BackfillSettings }) {
  const today = useBrowserToday()
  return createElement(TimeEntryForm, {
    today, minLogDate: today ? backfillMinDate(today, settings) : '9999-12-31',
    projects: [], activityTypes: [], onLogged: () => {},
  })
}
function render(settings: BackfillSettings) { return renderToString(createElement(CalendarForm, { settings })) }
const days: BackfillSettings = { mode: 'days', windowDays: 1, extraDays: 0 }
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); phase.value = 'server' })

describe('SSR calendar activation before entry controls', () => {
  it.each([
    ['2026-09-30T23:30:00Z', 'America/Los_Angeles', 'Pacific/Kiritimati', '2026-09-30', '2026-10-01'],
    ['2026-12-31T23:30:00Z', 'Pacific/Kiritimati', 'America/Los_Angeles', '2027-01-01', '2026-12-31'],
  ])('keeps server/hydration markup identical at %s despite opposing local days', (instant, serverZone, browserZone, serverDay, browserDay) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(instant))
    vi.stubEnv('TZ', serverZone)
    expect(todayISO()).toBe(serverDay)
    phase.value = 'server'
    const html = render(days)
    vi.stubEnv('TZ', browserZone)
    expect(todayISO()).toBe(browserDay)
    phase.value = 'hydration'
    expect(render(days)).toBe(html)
    expect(html).toContain('Preparing local calendar')
    expect(html).not.toContain('type="date"')
    expect(html).not.toContain('Submit Entry')
    expect(html).not.toContain('Quick-fill')
    expect(html).not.toContain('Writable from')
    // One confirmed local snapshot initializes every date-dependent field.
    phase.value = 'local'
    const local = render(days)
    expect(local).toContain(`value="${browserDay}"`)
    expect(local).toContain(`max="${browserDay}"`)
    expect(local).toContain(`min="${backfillMinDate(browserDay, days)}"`)
    expect(local).toContain(`Writable from ${backfillMinDate(browserDay, days)} (today included)`)
    expect(local).toContain('Submit Entry')
    expect(local).not.toContain('Preparing local calendar')
    expect(local.match(/<input[^>]*type="date"[^>]*>/)?.[0]).not.toContain('disabled')
  })
  it.each([
    [{ mode: 'days', windowDays: 2, extraDays: 0 }, '2026-09-29'],
    [{ mode: 'month_start', windowDays: 0, extraDays: 2 }, '2026-09-29'],
  ] as const)('retains local backfill policy for %j across month activation', (settings, minimum) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T23:30:00Z')); vi.stubEnv('TZ', 'Pacific/Kiritimati')
    phase.value = 'local'
    const html = render(settings)
    expect(html).toContain(`min="${minimum}"`)
    expect(html).toContain('max="2026-10-01"')
    expect(html).toContain('value="2026-10-01"')
    expect(html).toContain(`Writable from ${minimum}`)
  })
})

function seedForDates(dates: string[]): DashboardSeed {
  const profile: User = { id: 'alice', email: 'alice@example.test', name: 'Alice', department: 'Engineering', title: 'Engineer',
    role: 'admin', permission_role: 'admin', hierarchy_role: 'engineer', is_active: true, manager_id: null,
    dashboard_layout: DEFAULT_DASHBOARD_LAYOUT, admin_layout: DEFAULT_ADMIN_LAYOUT, mobile_layout: null, created_at: '2020-01-01' }
  const rows: Timesheet[] = dates.map((date, index) => ({ id: `seed-${index}`, user_id: profile.id,
    project_id: 'project', activity_type_id: 'activity', log_date: date, hours_worked: 2,
    work_done: `Seeded work ${index}`, created_at: '2020-01-01', projects: { name: 'Project' }, activity_types: { name: 'Development' } }))
  return { session: { id: profile.id, email: profile.email }, identityError: null, profile, profileError: null,
    projects: { data: [], error: null }, activityTypes: { data: [], error: null }, people: { data: [profile], error: null },
    backfill: { data: days, error: null }, layouts: { data: { dashboard: DEFAULT_DASHBOARD_LAYOUT, admin: DEFAULT_ADMIN_LAYOUT }, error: null },
    isSuperAdmin: false, page: { user: '', page: 1, size: 50 }, entries: { data: { rows, count: rows.length }, error: null }, month: null }
}
function dashboardHtml(seed: DashboardSeed) {
  return renderToString(createElement(ThemeProvider, { initialTheme: 'light' } as Parameters<typeof ThemeProvider>[0], createElement(DashboardClient, { seed })))
}

describe('entire seeded dashboard shares the unknown-to-local calendar', () => {
  it('keeps server-Today/Yesterday rows visible with byte-identical hydration markup despite a future browser clock', () => {
    vi.useFakeTimers(); vi.stubEnv('TZ', 'UTC'); vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    const seed = seedForDates(['2026-10-04', '2026-10-03', '2099-01-01'])
    phase.value = 'server'
    const server = dashboardHtml(seed)
    vi.setSystemTime(new Date('2099-01-01T12:00:00Z'))
    phase.value = 'hydration'
    const hydration = dashboardHtml(seed)
    expect(hydration).toBe(server)
    for (const date of ['2026-10-04', '2026-10-03', '2099-01-01']) expect(server).toContain(`>${date}</td>`)
    expect(server).toContain('Seeded work 0')
    expect(server).not.toContain('id="date-group-today"')
    expect(server).not.toContain('>Yesterday</td>')
    expect(server.match(/<button[^>]*title="Jump to today"[^>]*>/)?.[0]).toContain(' disabled=""')
    expect(server.match(/<button[^>]*data-shortcut="edit-last"[^>]*>/)?.[0]).toContain(' disabled=""')
    expect(server).not.toContain('Today: 2026-10-04')
    expect(server).not.toContain('type="date"')
    phase.value = 'local'
    const local = dashboardHtml(seed)
    expect(local).toContain('id="date-group-today"')
    expect(local).toMatch(/>Today<\/td>/)
    expect(local).toContain('Seeded work 0')
    expect(local).toContain('value="2099-01-01"')
    expect(local).toContain('min="2098-12-31"')
    expect(local).toContain('max="2099-01-01"')
    expect(local).toContain('Today: 2099-01-01')
    expect(local.match(/<button[^>]*title="Jump to today"[^>]*>/)?.[0]).not.toContain(' disabled=""')
    expect(local.match(/<button[^>]*data-shortcut="edit-last"[^>]*>/)?.[0]).not.toContain(' disabled=""')
  })
  it('activates relative Yesterday labels only from the shared confirmed day', () => {
    vi.useFakeTimers(); vi.stubEnv('TZ', 'Pacific/Kiritimati'); vi.setSystemTime(new Date('2026-12-31T23:30:00Z'))
    const seed = seedForDates(['2027-01-01', '2026-12-31'])
    phase.value = 'hydration'
    const initial = dashboardHtml(seed)
    expect(initial).not.toContain('>Yesterday</td>'); expect(initial).not.toContain('id="date-group-today"')
    phase.value = 'local'
    const local = dashboardHtml(seed)
    expect(local).toMatch(/>Yesterday<\/td>/)
    expect(local).toMatch(/>Today<\/td>/)
    expect(local).toContain('Today: 2027-01-01')
  })
  it('initializes leave month and Today from the confirmed prop even when its render clock differs', () => {
    vi.useFakeTimers(); vi.stubEnv('TZ', 'UTC'); vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    const html = renderToString(createElement(LeavePanel, { today: '2099-01-01', variant: 'admin', userId: 'alice', users: [] }))
    expect(html).toContain('Today: 2099-01-01')
    expect(html).toContain('value="2099-01"')
    expect(html).not.toContain('Today: 2026-10-04')
  })
})
