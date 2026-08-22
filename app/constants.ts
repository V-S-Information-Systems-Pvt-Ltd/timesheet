// app/constants.ts
// Shared app-wide constants.
import type { AdminDashboardLayout, AdminTileId, DashboardLayout, TileId, UserRole } from '@/app/types'

export const ROLES: UserRole[] = ['admin', 'pm', 'co', 'manager', 'team_lead', 'user']

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  pm: 'PM',
  co: 'CO',
  manager: 'Manager',
  team_lead: 'Team Lead',
  user: 'User',
}

export const TITLES = [
  'Intern',
  'Associate Systems Engineer',
  'Systems Engineer',
  'Senior Systems Engineer',
  'Team Lead',
  'Manager',
] as const

export type UserTitle = (typeof TITLES)[number]

/**
 * Determine the hierarchy role for a given title, preserving administrative roles (admin/pm/co).
 */
export function roleForTitle(title: string, currentRole?: UserRole): UserRole {
  if (currentRole === 'admin' || currentRole === 'pm' || currentRole === 'co') {
    return currentRole
  }
  const clean = title.trim().toLowerCase()
  if (clean === 'manager') return 'manager'
  if (clean === 'team lead' || clean === 'team_lead') return 'team_lead'
  return 'user'
}


/** The dashboard tiles users can enable/disable and reorder. */
export const TILE_IDS: TileId[] = [
  'entry-form',
  'entries',
  'leave',
  'reminders',
  'global-reminders',
  'profile',
  'telegram',
]

export const TILE_LABELS: Record<TileId, string> = {
  'entry-form': 'Log Time',
  entries: 'Recent Entries',
  leave: 'Leave',
  reminders: 'Reminders',
  'global-reminders': 'Global Reminders',
  profile: 'My Profile',
  telegram: 'Telegram Bot Commands',
}

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  tiles: TILE_IDS.map(id => ({ id, enabled: true })),
}

/** The admin-panel tiles that can be enabled/disabled and reordered. */
export const ADMIN_TILE_IDS: AdminTileId[] = [
  'settings',
  'user-whitelist',
  'hierarchy',
  'add-user',
  'backfill',
  'activity-types',
  'global-reminders',
  'project-manager',
  'leave-admin',
  'report-export',
  'import',
  'backup',
  'super-admin',
]

export const ADMIN_TILE_LABELS: Record<AdminTileId, string> = {
  settings: 'Settings',
  'user-whitelist': 'Users',
  hierarchy: 'Hierarchy',
  'add-user': 'Add User',
  backfill: 'Backfill',
  'activity-types': 'Activity Types',
  'global-reminders': 'Global Reminders',
  'project-manager': 'Projects',
  'leave-admin': 'Leave Admin',
  'report-export': 'Reports',
  import: 'Import',
  backup: 'Backup & Restore',
  'super-admin': 'Super Admin',
}

export const DEFAULT_ADMIN_LAYOUT: AdminDashboardLayout = {
  tiles: ADMIN_TILE_IDS.map(id => ({ id, enabled: true })),
}
