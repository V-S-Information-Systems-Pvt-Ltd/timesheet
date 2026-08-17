// app/constants.ts
// Shared app-wide constants.
import type { DashboardLayout, TileId, UserRole } from '@/app/types'

export const ROLES: UserRole[] = ['admin', 'pm', 'co', 'user']

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  pm: 'PM',
  co: 'CO',
  user: 'User',
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
