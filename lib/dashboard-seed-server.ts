import 'server-only'

import { cache } from 'react'
import { getRenderIdentity } from '@/lib/auth/render'
import { peopleDeps } from '@/lib/db/people'
import { referenceDeps } from '@/lib/db/reference'
import { workspaceDeps } from '@/lib/db/workspace'
import { timesheetDeps } from '@/lib/db/timesheets'
import { reportingDeps } from '@/lib/db/reporting'
import { getSelfProfileDomain, listPeopleDomain } from '@/lib/domain/people'
import { listActivityTypes, listProjects } from '@/lib/domain/reference'
import { getBackfillSettings, getDefaultLayouts } from '@/lib/domain/workspace'
import { listTimesheetsDomain } from '@/lib/domain/timesheets'
import { getReportTotals } from '@/lib/domain/reporting'
import { canViewTeamActor, isSuperAdminActor } from '@/lib/roles'
import { DEFAULT_ADMIN_LAYOUT, DEFAULT_DASHBOARD_LAYOUT } from '@/app/constants'
import { dashboardMonthRange } from '@/lib/dashboard-month-totals'
import { entriesPageFromSearch, entriesPageQuery } from '@/lib/dashboard-timesheets'
import {
  alignedDashboardActor, projectAdminLayout, projectDashboardActivity, projectDashboardEntry,
  projectDashboardLayout, projectDashboardProfile, projectDashboardProject,
  type DashboardSeed, type SeedRead,
} from '@/lib/dashboard-seed'

// Second real render consumer of the composite identity. cache() is request-only.
const getRenderSelfProfile = cache(async () => {
  const { actor } = await getRenderIdentity()
  if (!actor) return null
  return getSelfProfileDomain(actor, peopleDeps())
})

async function settle<T>(read: () => Promise<T>, message: string): Promise<SeedRead<T>> {
  try { return { data: await read(), error: null } }
  catch { return { data: null, error: message } }
}
function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export async function getDashboardSeed(search: URLSearchParams): Promise<DashboardSeed> {
  const empty = { data: null, error: null }
  const seed: DashboardSeed = {
    session: null, identityError: null, profile: null, profileError: null, projects: empty, activityTypes: empty,
    people: empty, backfill: empty, layouts: empty, isSuperAdmin: false,
    page: entriesPageFromSearch(search), entries: empty, month: null,
  }
  let identity: Awaited<ReturnType<typeof getRenderIdentity>>
  try { identity = await getRenderIdentity() }
  catch { seed.identityError = 'Could not validate your session. Please try again.'; return seed }
  seed.session = identity.session
  if (!identity.session) return seed
  // A null actor can mean a suppressed provider profile error, not just absence.
  if (!identity.actor) { seed.profileError = 'Could not load your profile.'; return seed }
  const actor = identity.actor
  try {
    const result = await getRenderSelfProfile()
    const profile = result ? unwrap(result) : null
    if (!profile) { seed.profileError = 'Your profile could not be found. Please contact an administrator.'; return seed }
    if (!alignedDashboardActor(actor, profile)) { seed.profileError = 'Your account changed while loading. Please try again.'; return seed }
    seed.profile = projectDashboardProfile(profile)
  } catch { seed.profileError = 'Could not load your profile.'; return seed }
  if (!actor.isActive) return seed
  if (!canViewTeamActor(actor)) seed.page.user = ''
  seed.isSuperAdmin = isSuperAdminActor(actor)
  const range = dashboardMonthRange()
  const [projects, activities, people, backfill, layouts, entries, totals] = await Promise.all([
    settle(async () => unwrap(await listProjects(actor, referenceDeps())).map(projectDashboardProject), 'Could not load projects.'),
    settle(async () => unwrap(await listActivityTypes(actor, referenceDeps())).map(projectDashboardActivity), 'Could not load activity types.'),
    canViewTeamActor(actor)
      ? settle(async () => unwrap(await listPeopleDomain(actor, peopleDeps())).map(projectDashboardProfile), 'Could not load team profiles.')
      : Promise.resolve({ data: [], error: null }),
    settle(async () => {
      const b = unwrap(await getBackfillSettings(actor, workspaceDeps()))
      return { mode: b.mode, windowDays: b.windowDays, extraDays: b.extraDays }
    }, 'Could not load backfill settings.'),
    settle(async () => {
      const l = unwrap(await getDefaultLayouts(actor, workspaceDeps()))
      return { dashboard: projectDashboardLayout(l.dashboard) ?? DEFAULT_DASHBOARD_LAYOUT,
        admin: projectAdminLayout(l.admin) ?? DEFAULT_ADMIN_LAYOUT }
    }, 'Could not load default layouts.'),
    settle(async () => {
      const result = unwrap(await listTimesheetsDomain(actor, { ...entriesPageQuery(seed.page), includeCount: true }, timesheetDeps()))
      return { rows: result.rows.map(projectDashboardEntry), count: result.count }
    }, 'Could not load entries.'),
    settle(async () => {
      const t = await getReportTotals(actor, { from: range.from, to: range.to }, 'user', reportingDeps())
      return { totalHours: t.totalHours, totalEntries: t.totalEntries }
    }, 'Could not load this month’s totals.'),
  ])
  seed.projects = projects; seed.activityTypes = activities; seed.people = people
  seed.backfill = backfill; seed.layouts = layouts; seed.entries = entries
  seed.month = { range, state: totals.data
    ? { status: 'ready', totals: totals.data, error: null }
    : { status: 'error', totals: null, error: totals.error || 'Could not load this month’s totals.' } }
  return seed
}
