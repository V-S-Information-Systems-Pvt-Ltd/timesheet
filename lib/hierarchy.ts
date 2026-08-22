// lib/hierarchy.ts
// Pure helpers for the user-hierarchy feature: which profiles may act as
// managers/team leads and what a "Reports to" dropdown should offer.
import type { User, UserRole } from '@/app/types'

export const LEADER_ROLES: readonly ('manager' | 'team_lead')[] = ['manager', 'team_lead']

/** True when the role or title is a manager or team lead. */
export function isLeaderRole(role: UserRole): boolean {
  return role === 'manager' || role === 'team_lead'
}

/** True when the user profile can act as a team lead or manager. */
export function isLeader(user: { role: UserRole; title?: string }): boolean {
  if (isLeaderRole(user.role)) return true
  const title = (user.title || '').trim().toLowerCase()
  return title === 'manager' || title === 'team lead' || title === 'team_lead'
}

/** All users who can act as a reporting target. */
export function leaderUsers(users: readonly User[]): User[] {
  return users.filter((u) => isLeader(u))
}

/**
 * Check whether setting `userId`'s manager to `targetManagerId` creates a reporting cycle.
 * Returns true if a cycle would be introduced (or if self-reporting).
 */
export function wouldCreateHierarchyCycle(
  users: readonly User[],
  userId: string,
  targetManagerId: string | null
): boolean {
  if (!targetManagerId) return false
  if (userId === targetManagerId) return true

  const managerMap = new Map(users.map((u) => [u.id, u.manager_id]))
  // Simulate the new relationship
  managerMap.set(userId, targetManagerId)

  const visited = new Set<string>()
  let current: string | null | undefined = targetManagerId

  while (current) {
    if (current === userId) return true
    if (visited.has(current)) return true // existing cycle
    visited.add(current)
    current = managerMap.get(current)
  }

  return false
}

/**
 * Flexible reporting targets for `user` (or a new user when `user` is null):
 * Allows reporting to Engineers, Senior Engineers, Team Leads, Managers, Admins, etc.,
 * while preventing self-reporting and circular reporting loops.
 */
export function candidateManagers(user: User | null, users: readonly User[]): User[] {
  const out: User[] = []
  const seen = new Set<string>()

  for (const u of users) {
    if (!u.is_active && (!user || u.id !== user.manager_id)) continue
    if (user && u.id === user.id) continue
    if (user && wouldCreateHierarchyCycle(users, user.id, u.id)) continue
    if (seen.has(u.id)) continue

    seen.add(u.id)
    out.push(u)
  }

  return out
}

/**
 * Options for the "Reports to" dropdown of `user`:
 *  - every user where assigning them would NOT create a circular hierarchy loop.
 *  - the user's current manager even if inactive, so the current value stays representable.
 */
export function reportToOptions(user: User, users: readonly User[]): User[] {
  return candidateManagers(user, users)
}