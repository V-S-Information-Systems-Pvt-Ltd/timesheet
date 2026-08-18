// lib/hierarchy.ts
// Pure helpers for the user-hierarchy feature: which profiles may act as
// managers/team leads and what a "Reports to" dropdown should offer.
// Shared by the user whitelist and the add-user form.
import type { User, UserRole } from '@/app/types'

export const LEADER_ROLES: readonly ('manager' | 'team_lead')[] = ['manager', 'team_lead']

/** True when the role is a manager or team lead (a person others report to). */
export function isLeaderRole(role: UserRole): boolean {
  return role === 'manager' || role === 'team_lead'
}

/** All users who can act as a reporting target. */
export function leaderUsers(users: readonly User[]): User[] {
  return users.filter((u) => isLeaderRole(u.role))
}

/**
 * Options for the "Reports to" dropdown of `user`:
 *  - every leader except the user themself (self-reporting is invalid), and
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
    seen.add(l.id)
    out.push(l)
  }
  if (current && current.id !== user.id && !seen.has(current.id)) {
    out.push(current)
  }
  return out
}