import { ADMIN_TILE_IDS, ADMIN_TILE_LABELS, DEFAULT_ADMIN_LAYOUT, DEFAULT_DASHBOARD_LAYOUT, TILE_LABELS } from '@/app/constants'
import type { AdminDashboardLayout, AdminTileId, DashboardLayout, HierarchyRole, PermissionRole, TileId } from '@/app/types'
import { completeLayout, forceTileEnabled, resolveLayout } from '@/lib/layout'

/**
 * Which full-screen account view the dashboard should render once the session
 * and profile load have settled. A failed or missing profile must never be
 * presented as "pending approval" — that claims an account state we don't know.
 */
export type AccountView = 'error' | 'pending' | 'ready'

export function classifyAccountView(
  profile: { is_active: boolean } | null,
  profileError: string | null
): AccountView {
  if (profileError || !profile) return 'error'
  return profile.is_active ? 'ready' : 'pending'
}

// --- sidebar navigation -------------------------------------------------------
// Pure model for the left accordion menu: every dashboard tile is its own menu
// item. The dashboard and the other app pages build the same groups from the
// profile, saved/default layouts and the super-admin capability.


export type DashboardTab = 'user' | 'team' | 'admin'

export interface NavItem {
  key: string
  label: string
  href: string
}

export interface NavGroup {
  key: 'my' | 'team' | 'admin' | 'reports'
  label: string
  /** Groups without items are plain links. */
  href?: string
  items: NavItem[]
}

export interface NavAccess {
  permission: PermissionRole
  hierarchy: HierarchyRole
  isActive: boolean
  superAdmin: boolean
  /** Admin/CO limited to some departments: org-wide panels are hidden. */
  scoped?: boolean
}

export function navAccess(access: NavAccess) {
  const isAdmin = access.permission === 'admin'
  const canManageProjects = isAdmin || access.permission === 'pm'
  const canGenerateReports = isAdmin || access.permission === 'co'
  const canViewTeam = isAdmin || access.permission === 'co' || access.hierarchy === 'manager' || access.hierarchy === 'team_lead'
  return {
    isAdmin,
    canManageProjects,
    canGenerateReports,
    canViewTeam,
    showAdminPanel: isAdmin || canManageProjects || canGenerateReports,
  }
}

/** Panels whose server actions require an admin with no department limit. */
const ORG_WIDE_TILES = new Set<AdminTileId>(['settings', 'departments', 'global-reminders', 'import', 'backup'])

/** Whether a role may open an admin panel at all (layout only orders/hides). */
export function adminTileAllowed(id: AdminTileId, access: NavAccess): boolean {
  const can = navAccess(access)
  if (id === 'super-admin') return access.superAdmin
  if (access.scoped && ORG_WIDE_TILES.has(id)) return false
  if (id === 'project-manager') return can.canManageProjects
  if (id === 'report-export') return can.canGenerateReports
  return can.isAdmin
}

/** Visible, ordered tiles for both menus. The super-admin panel can never be hidden. */
export function resolveNavTiles(input: {
  saved: { dashboard: DashboardLayout | null | undefined; admin: AdminDashboardLayout | null | undefined }
  defaults: { dashboard: DashboardLayout; admin: AdminDashboardLayout } | null
  access: NavAccess
}): { userTiles: TileId[]; adminTiles: AdminTileId[]; dashDefault: DashboardLayout; adminDefault: AdminDashboardLayout; userLayout: DashboardLayout; adminLayout: AdminDashboardLayout } {
  const { saved, defaults, access } = input
  const dashDefault = completeLayout(defaults?.dashboard, DEFAULT_DASHBOARD_LAYOUT)
  const userLayout = completeLayout(saved.dashboard, dashDefault)
  const offered = access.superAdmin ? ADMIN_TILE_IDS : ADMIN_TILE_IDS.filter(id => id !== 'super-admin')
  const base = completeLayout(defaults?.admin, DEFAULT_ADMIN_LAYOUT)
  const filtered = { tiles: base.tiles.filter(t => offered.includes(t.id)) }
  const adminDefault = access.superAdmin ? forceTileEnabled(filtered, 'super-admin') : filtered
  const savedAdmin = saved.admin ? { tiles: saved.admin.tiles.filter(t => offered.includes(t.id)) } : null
  const adminLayout = access.superAdmin
    ? forceTileEnabled(savedAdmin ?? adminDefault, 'super-admin')
    : savedAdmin ?? adminDefault
  return {
    userTiles: resolveLayout(userLayout, dashDefault) as TileId[],
    adminTiles: (resolveLayout(adminLayout, adminDefault) as AdminTileId[]).filter(id => adminTileAllowed(id, access)),
    dashDefault,
    adminDefault,
    userLayout,
    adminLayout,
  }
}

export function dashboardHref(tab: DashboardTab, panel?: string): string {
  return panel ? `/dashboard?tab=${tab}&panel=${panel}` : `/dashboard?tab=${tab}`
}

export function navKey(tab: DashboardTab, panel?: string): string {
  return panel ? `${tab}:${panel}` : tab
}

export const TEAM_VIEWS = [
  { key: 'tree', label: 'Org Tree' },
  { key: 'directory', label: 'Directory' },
] as const
export type TeamViewKey = (typeof TEAM_VIEWS)[number]['key']

export const REPORT_TABS = [
  { key: 'myhours', label: 'My Hours' },
  { key: 'summaries', label: 'Summaries' },
  { key: 'reports', label: 'Reports', reportRole: true },
  { key: 'compare', label: 'Compare' },
  { key: 'missing', label: 'My Missing' },
  { key: 'calendar', label: 'Holiday Calendar' },
] as const

export function reportNavKey(tab: string): string {
  return `reports:${tab}`
}

export function buildNavGroups(access: NavAccess, tiles: { userTiles: TileId[]; adminTiles: AdminTileId[] }): NavGroup[] {
  if (!access.isActive) return []
  const can = navAccess(access)
  const groups: NavGroup[] = [{
    key: 'my',
    label: 'My timesheet',
    items: tiles.userTiles.map(id => ({ key: navKey('user', id), label: TILE_LABELS[id], href: dashboardHref('user', id) })),
  }]
  // The org tree is visible to everyone; opening timesheets stays hierarchy-scoped.
  groups.push({
    key: 'team',
    label: 'Team',
    items: TEAM_VIEWS.map(v => ({ key: navKey('team', v.key), label: v.label, href: `${dashboardHref('team')}&view=${v.key}` })),
  })
  groups.push({
    key: 'reports',
    label: 'Reports',
    items: REPORT_TABS.filter(t => !('reportRole' in t) || can.canGenerateReports)
      .map(t => ({ key: reportNavKey(t.key), label: t.label, href: `/reports?tab=${t.key}` })),
  })
  if (can.showAdminPanel && tiles.adminTiles.length > 0) {
    groups.push({
      key: 'admin',
      label: 'Administration',
      items: tiles.adminTiles.map(id => ({ key: navKey('admin', id), label: ADMIN_TILE_LABELS[id], href: dashboardHref('admin', id) })),
    })
  }
  return groups
}
