import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User, Timesheet } from '@/app/types'
import type { Actor } from '@/lib/db/types'
import { DEFAULT_ADMIN_LAYOUT, DEFAULT_DASHBOARD_LAYOUT } from '@/app/constants'
import { getDashboardSeed } from '@/lib/dashboard-seed-server'

const mocks = vi.hoisted(() => ({
  identity: vi.fn(), profile: vi.fn(), projects: vi.fn(), activities: vi.fn(), people: vi.fn(),
  backfill: vi.fn(), layouts: vi.fn(), entries: vi.fn(), totals: vi.fn(),
}))
vi.mock('@/lib/auth/render', () => ({ getRenderIdentity: mocks.identity }))
vi.mock('@/lib/domain/people', () => ({ getSelfProfileDomain: mocks.profile, listPeopleDomain: mocks.people }))
vi.mock('@/lib/domain/reference', () => ({ listProjects: mocks.projects, listActivityTypes: mocks.activities }))
vi.mock('@/lib/domain/workspace', () => ({ getBackfillSettings: mocks.backfill, getDefaultLayouts: mocks.layouts }))
vi.mock('@/lib/domain/timesheets', () => ({ listTimesheetsDomain: mocks.entries }))
vi.mock('@/lib/domain/reporting', () => ({ getReportTotals: mocks.totals }))
vi.mock('@/lib/db/people', () => ({ peopleDeps: () => ({}) }))
vi.mock('@/lib/db/reference', () => ({ referenceDeps: () => ({}) }))
vi.mock('@/lib/db/workspace', () => ({ workspaceDeps: () => ({}) }))
vi.mock('@/lib/db/timesheets', () => ({ timesheetDeps: () => ({}) }))
vi.mock('@/lib/db/reporting', () => ({ reportingDeps: () => ({}) }))

const profile = (patch: Partial<User> = {}): User => ({
  id: 'alice', email: 'alice@example.test', name: 'Alice', department: 'Engineering', title: 'Engineer',
  role: 'admin', permission_role: 'admin', hierarchy_role: 'manager', is_active: true, manager_id: null,
  dashboard_layout: null, admin_layout: null, mobile_layout: null, created_at: '2020-01-01', ...patch,
})
const actor = (p = profile()): Actor => ({ id: p.id, email: p.email, role: p.role,
  permission_role: p.permission_role, hierarchy_role: p.hierarchy_role, isActive: p.is_active })
const ok = <T>(data: T) => ({ ok: true, data })
const ancillary = () => [mocks.projects, mocks.activities, mocks.people, mocks.backfill, mocks.layouts, mocks.entries, mocks.totals]
const entry: Timesheet = { id: 'row', user_id: 'alice', project_id: 'project', activity_type_id: null,
  log_date: '2020-01-01', hours_worked: 2, work_done: 'Work', created_at: '2020-01-01' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.identity.mockResolvedValue({ actor: actor(), session: { id: 'alice', email: 'alice@example.test' } })
  mocks.profile.mockResolvedValue(ok(profile()))
  mocks.projects.mockResolvedValue(ok([{ id: 'project', name: 'Project', so_number: null, telegram_no: 1, created_at: '2020-01-01' }]))
  mocks.activities.mockResolvedValue(ok([])); mocks.people.mockResolvedValue(ok([profile()]))
  mocks.backfill.mockResolvedValue(ok({ mode: 'days', windowDays: 30, extraDays: 0 }))
  mocks.layouts.mockResolvedValue(ok({ dashboard: DEFAULT_DASHBOARD_LAYOUT, admin: DEFAULT_ADMIN_LAYOUT }))
  mocks.entries.mockResolvedValue(ok({ rows: [entry], count: 1001 }))
  mocks.totals.mockResolvedValue({ totalHours: 9000, totalEntries: 3000, byGroup: [] })
})

describe('server dashboard seed gates and independent reads', () => {
  it('seeds bounded URL paging, scoped people and full month aggregates', async () => {
    const seed = await getDashboardSeed(new URLSearchParams('page=3&size=25&user=bob'))
    expect(seed.entries.data).toEqual({ rows: [{ ...entry, projects: null, profiles: null, activity_types: null }], count: 1001 })
    expect(mocks.entries).toHaveBeenCalledWith(actor(), { from: 50, to: 74, userId: 'bob', includeCount: true }, {})
    expect(mocks.people).toHaveBeenCalledWith(actor(), {})
    expect(seed.month?.state).toEqual({ status: 'ready', totals: { totalHours: 9000, totalEntries: 3000 }, error: null })
    expect(mocks.totals).toHaveBeenCalledWith(actor(), { from: seed.month?.range.from, to: seed.month?.range.to }, 'user', {})
  })
  it('removes actor filters and people reads for personal scope', async () => {
    const p = profile({ role: 'user', permission_role: 'user', hierarchy_role: 'engineer' })
    mocks.identity.mockResolvedValue({ actor: actor(p), session: { id: p.id, email: p.email } })
    mocks.profile.mockResolvedValue(ok(p))
    const seed = await getDashboardSeed(new URLSearchParams('size=1000&page=2&user=bob'))
    expect(seed.page).toEqual({ user: '', size: 50, page: 2 })
    expect(mocks.people).not.toHaveBeenCalled()
    expect(mocks.entries.mock.calls[0][1]).toEqual({ from: 50, to: 99, userId: undefined, includeCount: true })
  })
  it('preserves signed-out fallback without profile or privileged reads', async () => {
    mocks.identity.mockResolvedValue({ actor: null, session: null })
    const seed = await getDashboardSeed(new URLSearchParams())
    expect(seed.session).toBeNull(); expect(seed.identityError).toBeNull(); expect(seed.profileError).toBeNull()
    expect(mocks.profile).not.toHaveBeenCalled()
    ancillary().forEach(read => expect(read).not.toHaveBeenCalled())
  })
  it('keeps thrown identity/storage failure distinct from signed-out', async () => {
    mocks.identity.mockRejectedValue(new Error('storage unavailable'))
    const seed = await getDashboardSeed(new URLSearchParams())
    expect(seed.identityError).toContain('validate your session')
    expect(seed.profile).toBeNull()
    ancillary().forEach(read => expect(read).not.toHaveBeenCalled())
  })
  it('treats actor-null plus authenticated session as retryable unavailable, never pending', async () => {
    mocks.identity.mockResolvedValue({ actor: null, session: { id: 'alice', email: 'alice@example.test' } })
    const seed = await getDashboardSeed(new URLSearchParams())
    expect(seed.profile).toBeNull(); expect(seed.profileError).toBe('Could not load your profile.')
    expect(mocks.profile).not.toHaveBeenCalled()
    ancillary().forEach(read => expect(read).not.toHaveBeenCalled())
  })
  it.each(['missing', 'throw', 'error'])('keeps %s self profile distinct from pending', async mode => {
    if (mode === 'missing') mocks.profile.mockResolvedValue(ok(null))
    if (mode === 'throw') mocks.profile.mockRejectedValue(new Error('unavailable'))
    if (mode === 'error') mocks.profile.mockResolvedValue({ ok: false, error: { message: 'unavailable' } })
    const seed = await getDashboardSeed(new URLSearchParams())
    expect(seed.profileError).toBeTruthy(); expect(seed.profile).toBeNull()
    ancillary().forEach(read => expect(read).not.toHaveBeenCalled())
  })
  it('renders explicit inactive self profile without ancillary reads', async () => {
    const p = profile({ is_active: false })
    mocks.identity.mockResolvedValue({ actor: actor(p), session: { id: p.id, email: p.email } })
    mocks.profile.mockResolvedValue(ok(p))
    const seed = await getDashboardSeed(new URLSearchParams())
    expect(seed.profile?.is_active).toBe(false); expect(seed.profileError).toBeNull()
    ancillary().forEach(read => expect(read).not.toHaveBeenCalled())
  })
  it.each<Partial<User>>([{ id: 'bob' }, { email: 'bob@example.test' }, { role: 'user' },
    { permission_role: 'co' }, { hierarchy_role: 'engineer' }, { is_active: false }])('fails closed before ancillary reads on drift %j', async patch => {
    mocks.profile.mockResolvedValue(ok(profile(patch)))
    const seed = await getDashboardSeed(new URLSearchParams())
    expect(seed.profileError).toContain('changed'); expect(seed.profile).toBeNull()
    ancillary().forEach(read => expect(read).not.toHaveBeenCalled())
  })
  it('keeps unrelated successes when several ancillary reads fail, with retry states', async () => {
    mocks.projects.mockRejectedValue(new Error('provider secret'))
    mocks.backfill.mockResolvedValue({ ok: false, error: { message: 'unavailable' } })
    mocks.entries.mockRejectedValue(new Error('unavailable'))
    mocks.totals.mockRejectedValue(new Error('unavailable'))
    const seed = await getDashboardSeed(new URLSearchParams())
    expect(seed.profile).not.toBeNull(); expect(seed.projects.error).toContain('projects')
    expect(seed.activityTypes.data).toEqual([]); expect(seed.people.data).toHaveLength(1)
    expect(seed.layouts.data).not.toBeNull(); expect(seed.backfill.error).toBeTruthy()
    expect(seed.entries.error).toBeTruthy(); expect(seed.month?.state.status).toBe('error')
    expect(JSON.stringify(seed)).not.toContain('provider secret')
  })
  it('excludes persistence secrets from every row and nested layout/join DTO', async () => {
    const secret = { password_hash: 'SECRET_SENTINEL', session_version: 7, provider_metadata: 'SECRET_SENTINEL' }
    const p = { ...profile(), ...secret, dashboard_layout: { ...secret, tiles: [{ id: 'entries', enabled: true, ...secret }] },
      admin_layout: { ...secret, tiles: [{ id: 'settings', enabled: true, ...secret }] },
      mobile_layout: { ...secret, modules: [{ id: 'timesheets', enabled: true, placement: 'home', ...secret }] } } as User
    mocks.profile.mockResolvedValue(ok(p)); mocks.people.mockResolvedValue(ok([p]))
    mocks.projects.mockResolvedValue(ok([{ id: 'p', name: 'Project', ...secret }]))
    mocks.activities.mockResolvedValue(ok([{ id: 'a', name: 'Activity', ...secret }]))
    mocks.layouts.mockResolvedValue(ok({ dashboard: p.dashboard_layout, admin: p.admin_layout, mobile: p.mobile_layout, ...secret }))
    mocks.entries.mockResolvedValue(ok({ rows: [{ ...entry, ...secret, profiles: { email: p.email, ...secret }, projects: { name: 'Project', ...secret }, activity_types: { name: 'Activity', ...secret } }], count: 1 }))
    const seed = await getDashboardSeed(new URLSearchParams())
    const serialized = JSON.stringify(seed)
    for (const key of ['SECRET_SENTINEL', 'password_hash', 'session_version', 'provider_metadata']) expect(serialized).not.toContain(key)
    expect(seed.profile?.dashboard_layout).toEqual({ tiles: [{ id: 'entries', enabled: true }] })
    expect(seed.entries.data?.rows[0].profiles).toEqual({ email: p.email })
  })
})
