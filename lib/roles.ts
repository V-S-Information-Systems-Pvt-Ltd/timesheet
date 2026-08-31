// lib/roles.ts
// The separated two-axis role model:
//   * permission_role  — authorization: what a user is allowed to do
//                        (admin | pm | co | user)
//   * hierarchy_role   — reporting position in the org tree
//                        (manager | team_lead | user)
//
// The legacy single `role` column is kept (and kept in sync by a DB trigger on
// the profiles table) purely for the transition; new logic must key off the
// two axes above. See the migrations that add the columns and trigger.
import type { Actor } from '@/lib/db/repository'
import type { HierarchyRole, PermissionRole, UserRole } from '@/app/types'

export const PERMISSION_ROLES: readonly PermissionRole[] = ['admin', 'pm', 'co', 'user']
export const HIERARCHY_ROLES: readonly HierarchyRole[] = ['manager', 'team_lead', 'engineer', 'user']

export const PERMISSION_ROLE_LABELS: Record<PermissionRole, string> = {
  admin: 'Admin',
  pm: 'PM',
  co: 'CO',
  user: 'User',
}

export const HIERARCHY_ROLE_LABELS: Record<HierarchyRole, string> = {
  manager: 'Manager',
  team_lead: 'Team Lead',
  engineer: 'Engineer',
  user: 'User',
}

/** Map a legacy single role onto the two separated axes. */
export function rolePairFromLegacy(role: UserRole): {
  permission: PermissionRole
  hierarchy: HierarchyRole
} {
  switch (role) {
    case 'admin':
    case 'pm':
    case 'co':
      return { permission: role, hierarchy: 'user' }
    case 'manager':
    case 'team_lead':
      return { permission: 'user', hierarchy: role }
    default:
      return { permission: 'user', hierarchy: 'user' }
  }
}

/** Reverse map: the legacy role a given pair corresponds to. */
export function legacyRoleFromPair(permission: PermissionRole, hierarchy: HierarchyRole): UserRole {
  if (permission === 'admin' || permission === 'pm' || permission === 'co') return permission
  if (hierarchy === 'manager' || hierarchy === 'team_lead') return hierarchy
  return 'user'
}

/** True when the hierarchy position makes this person a reporting target. */
export function isLeaderHierarchy(role: HierarchyRole): boolean {
  return role === 'manager' || role === 'team_lead'
}

/** True when the permission role sees ALL entries/profiles (admin + co). */
export function canSeeAllPermission(role: PermissionRole): boolean {
  return role === 'admin' || role === 'co'
}

// --- actor helpers ----------------------------------------------------------

/** Gate helper: does the actor hold any of the given permission roles? */
export function hasPermission(actor: Actor, allowed: readonly PermissionRole[]): boolean {
  return allowed.includes(actor.permission_role)
}

export function isAdminActor(actor: Actor): boolean {
  return actor.permission_role === 'admin'
}

export function isLeaderActor(actor: Actor): boolean {
  return isLeaderHierarchy(actor.hierarchy_role)
}

export function canSeeAllActor(actor: Actor): boolean {
  return canSeeAllPermission(actor.permission_role)
}

/** True when the actor is allowed to view team members/people profiles. */
export function canViewTeamActor(actor: Actor): boolean {
  return isLeaderActor(actor) || canSeeAllActor(actor)
}

export interface ActorCapabilities {
  canViewTeam: boolean
  canManageProjects: boolean
  canManageActivities: boolean
  canManageUsers: boolean
  canManageSettings: boolean
}

/** Calculate unified product capabilities based on two-axis roles. */
export function getActorCapabilities(actor: Actor): ActorCapabilities {
  return {
    canViewTeam: canViewTeamActor(actor),
    canManageProjects: actor.permission_role === 'admin' || actor.permission_role === 'pm',
    canManageActivities: actor.permission_role === 'admin',
    canManageUsers: actor.permission_role === 'admin',
    canManageSettings: actor.permission_role === 'admin',
  }
}
