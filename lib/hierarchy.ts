// lib/hierarchy.ts
// Pure helpers for the user-hierarchy feature: which profiles may act as
// managers/team leads and what a "Reports to" dropdown should offer.
// Shared by the user whitelist and the add-user form.
// Hierarchy is the SEPARATE reporting axis (hierarchy_role), independent of
// the permission axis.
import type { User } from '@/app/types'
import { isLeaderHierarchy } from '@/lib/roles'

/**
 * True when the profile can act as a team lead or manager: its hierarchy role
 * is a leader role, or (transition fallback) its title marks it as one.
 */
export function isLeader(user: { hierarchy_role: User['hierarchy_role']; title?: string }): boolean {
  if (isLeaderHierarchy(user.hierarchy_role)) return true
  const title = (user.title || '').trim().toLowerCase()
  return title === 'manager' || title === 'team lead' || title === 'team_lead'
}

/** All users who can act as a reporting target. */
export function leaderUsers(users: readonly User[]): User[] {
  return users.filter((u) => isLeader(u))
}

/**
 * Check whether setting `userId`'s manager to `targetManagerId` creates a
 * reporting cycle. Returns true if a cycle would be introduced (or if
 * self-reporting).
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
 * Options for the "Reports to" dropdown of `user`:
 *  - every leader except the user themself and any target that would create a
 *    circular reporting loop, and
 *  - the user's current manager when that profile is no longer a leader, so
 *    the current value stays representable and never shows as "— None —".
 */
export function reportToOptions(user: User, users: readonly User[]): User[] {
  const byId = new Map(users.map((u) => [u.id, u]))
  const current = user.manager_id ? byId.get(user.manager_id) : undefined
  const out: User[] = []
  const seen = new Set<string>()
  for (const l of leaderUsers(users)) {
    if (l.id === user.id || seen.has(l.id)) continue
    if (wouldCreateHierarchyCycle(users, user.id, l.id)) continue
    seen.add(l.id)
    out.push(l)
  }
  if (current && current.id !== user.id && !seen.has(current.id)) {
    out.push(current)
  }
  return out
}