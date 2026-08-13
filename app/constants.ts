// app/constants.ts
// Shared app-wide constants.
import type { UserRole } from '@/app/types'

export const ROLES: UserRole[] = ['admin', 'pm', 'co', 'user']

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  pm: 'PM',
  co: 'CO',
  user: 'User',
}
