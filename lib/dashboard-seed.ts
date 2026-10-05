import type { ActivityType, AdminDashboardLayout, DashboardLayout, Project, Timesheet, User } from '@/app/types'
import { ADMIN_TILE_IDS, TILE_IDS } from '@/app/constants'
import { sanitizeMobileLayout } from '@/lib/layout'
import type { Actor } from '@/lib/db/types'
import type { ClientSessionUser, AuthStateEvent } from '@/lib/auth/client'
import type { BackfillSettings } from '@/lib/validation'
import type { DashboardMonthTotalsState, dashboardMonthRange } from '@/lib/dashboard-month-totals'
import type { EntriesPage } from '@/lib/dashboard-timesheets'

export type SeedRead<T> = { data: T | null; error: string | null }
export interface DashboardSeed {
  session: ClientSessionUser | null
  identityError: string | null
  profile: User | null
  profileError: string | null
  projects: SeedRead<Project[]>
  activityTypes: SeedRead<ActivityType[]>
  people: SeedRead<User[]>
  backfill: SeedRead<BackfillSettings>
  layouts: SeedRead<{ dashboard: DashboardLayout; admin: AdminDashboardLayout }>
  isSuperAdmin: boolean
  page: EntriesPage
  entries: SeedRead<{ rows: Timesheet[]; count: number }>
  month: { range: ReturnType<typeof dashboardMonthRange>; state: DashboardMonthTotalsState } | null
}

export function projectDashboardLayout(layout: DashboardLayout | null): DashboardLayout | null {
  return layout && Array.isArray(layout.tiles) ? { tiles: layout.tiles
    .filter(t => TILE_IDS.includes(t.id) && typeof t.enabled === 'boolean')
    .map(t => ({ id: t.id, enabled: t.enabled })) } : null
}
export function projectAdminLayout(layout: AdminDashboardLayout | null): AdminDashboardLayout | null {
  return layout && Array.isArray(layout.tiles) ? { tiles: layout.tiles
    .filter(t => ADMIN_TILE_IDS.includes(t.id) && typeof t.enabled === 'boolean')
    .map(t => ({ id: t.id, enabled: t.enabled })) } : null
}
/** Never spread a persistence profile, including inside saved layouts. */
export function projectDashboardProfile(p: User): User {
  return {
    id: p.id, email: p.email, name: p.name, department: p.department, title: p.title,
    role: p.role, permission_role: p.permission_role, hierarchy_role: p.hierarchy_role,
    is_active: p.is_active, manager_id: p.manager_id, created_at: p.created_at,
    dashboard_layout: projectDashboardLayout(p.dashboard_layout),
    admin_layout: projectAdminLayout(p.admin_layout),
    mobile_layout: p.mobile_layout ? sanitizeMobileLayout(p.mobile_layout) : null,
  }
}
export function projectDashboardProject(p: Project): Project {
  return { id: p.id, name: p.name, so_number: p.so_number, telegram_no: p.telegram_no, created_at: p.created_at }
}
export function projectDashboardActivity(p: ActivityType): ActivityType {
  return { id: p.id, name: p.name, is_active: p.is_active, telegram_no: p.telegram_no, created_at: p.created_at }
}
export function projectDashboardEntry(t: Timesheet): Timesheet {
  return {
    id: t.id, user_id: t.user_id, project_id: t.project_id, activity_type_id: t.activity_type_id,
    log_date: t.log_date, hours_worked: t.hours_worked, work_done: t.work_done, created_at: t.created_at,
    projects: t.projects ? { name: t.projects.name } : null,
    profiles: t.profiles ? { email: t.profiles.email } : null,
    activity_types: t.activity_types ? { name: t.activity_types.name } : null,
  }
}
export function alignedDashboardActor(actor: Actor, profile: User): boolean {
  return actor.id === profile.id && actor.email === profile.email && actor.role === profile.role &&
    actor.permission_role === profile.permission_role && actor.hierarchy_role === profile.hierarchy_role &&
    actor.isActive === profile.is_active
}
export function sameDashboardAuthorization(a: User, b: User): boolean {
  return a.id === b.id && a.role === b.role && a.permission_role === b.permission_role &&
    a.hierarchy_role === b.hierarchy_role && a.is_active === b.is_active
}
export function retainsDashboardSession(current: ClientSessionUser | null, next: ClientSessionUser | null, event?: AuthStateEvent): boolean {
  return Boolean(current && next && current.id === next.id && current.email === next.email &&
    (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED'))
}
export function dashboardPageScope(epoch: number, userId: string, page: EntriesPage): string {
  return `${epoch}:${userId}:${page.user}:${page.page}:${page.size}`
}

/** Mount-owned auth handoff. Confirmation and token renewal are not new sessions. */
export function createDashboardAuthHandoff(initial: ClientSessionUser | null, identityError: string | null = null) {
  let generation = 0
  let session = initial
  let initialConfirmed = false
  let disposed = false
  return {
    snapshot: () => ({ generation, session }),
    activate() { const resumed = disposed; disposed = false; return { generation, resumed } },
    receive(next: ClientSessionUser | null, event?: AuthStateEvent): 'ignore' | 'confirm' | 'retain' | 'replace' {
      if (disposed) return 'ignore'
      const retain = retainsDashboardSession(session, next, event)
      if (event === 'INITIAL_SESSION') {
        if (!next && identityError) return 'ignore'
        if (initialConfirmed && !retain) return 'ignore'
        if (!initialConfirmed && retain) { initialConfirmed = true; return 'confirm' }
      }
      initialConfirmed = true
      identityError = null
      return retain ? 'retain' : 'replace'
    },
    replace(next: ClientSessionUser | null) {
      initialConfirmed = true
      identityError = null
      session = next
      return ++generation
    },
    dispose() { disposed = true; initialConfirmed = true; return ++generation },
  }
}
