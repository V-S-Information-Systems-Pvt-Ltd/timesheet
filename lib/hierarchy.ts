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

export interface HierarchyTreeNode<T> {
  item: T
  children: HierarchyTreeNode<T>[]
  depth: number
  isOrphan?: boolean
  hasCycle?: boolean
}

export interface HierarchyTreeResult<T> {
  roots: HierarchyTreeNode<T>[]
  orphanCount: number
  totalCount: number
}

function getManagerId<T extends { id: string; manager_id?: string | null; managerId?: string | null }>(
  item: T
): string | null {
  return item.manager_id ?? item.managerId ?? null
}

function getSortKey<T extends { name?: string; email?: string }>(item: T): string {
  return (item.name || item.email || '').trim().toLowerCase()
}

function getHierarchyRoleRank<T extends { hierarchy_role?: string; hierarchyRole?: string }>(item: T): number {
  const role = item.hierarchy_role ?? item.hierarchyRole ?? 'user'
  switch (role) {
    case 'manager':
      return 1
    case 'team_lead':
      return 2
    case 'engineer':
      return 3
    case 'user':
    default:
      return 4
  }
}

/**
 * Pure projection that builds a hierarchical tree from a flat list of user profiles.
 * - Handles top-level roots (no manager or manager not in list)
 * - Sorts siblings stably by hierarchy role rank (Manager -> Lead -> Engineer -> User) then name
 * - Handles circular reporting references defensively without infinite recursion
 * - Captures detached cycle orphans at root with cycle annotation so no profiles are dropped
 */
export function buildHierarchyTree<
  T extends {
    id: string
    name?: string
    email?: string
    manager_id?: string | null
    managerId?: string | null
    hierarchy_role?: string
    hierarchyRole?: string
  }
>(items: readonly T[]): HierarchyTreeResult<T> {
  const byId = new Map<string, T>()
  const childrenMap = new Map<string, T[]>()

  for (const item of items) {
    byId.set(item.id, item)
  }

  const sortItems = (a: T, b: T): number => {
    const rankA = getHierarchyRoleRank(a)
    const rankB = getHierarchyRoleRank(b)
    if (rankA !== rankB) return rankA - rankB
    return getSortKey(a).localeCompare(getSortKey(b))
  }

  // Populate children mapping
  for (const item of items) {
    const mId = getManagerId(item)
    if (mId && byId.has(mId)) {
      const existing = childrenMap.get(mId) || []
      existing.push(item)
      childrenMap.set(mId, existing)
    }
  }

  // Sort child arrays
  for (const children of childrenMap.values()) {
    children.sort(sortItems)
  }

  const candidateRoots: T[] = []
  let orphanCount = 0

  for (const item of items) {
    const mId = getManagerId(item)
    if (!mId) {
      candidateRoots.push(item)
    } else if (!byId.has(mId)) {
      candidateRoots.push(item)
      orphanCount++
    }
  }

  candidateRoots.sort(sortItems)

  const visitedGlobal = new Set<string>()

  function buildNode(item: T, depth: number, branchPath: Set<string>, isOrphan = false): HierarchyTreeNode<T> {
    visitedGlobal.add(item.id)
    const nextBranch = new Set(branchPath).add(item.id)
    const rawChildren = childrenMap.get(item.id) || []
    const children: HierarchyTreeNode<T>[] = []

    for (const child of rawChildren) {
      if (nextBranch.has(child.id)) {
        // Cycle detected
        children.push({
          item: child,
          children: [],
          depth: depth + 1,
          hasCycle: true,
        })
        continue
      }
      if (visitedGlobal.has(child.id)) {
        continue
      }
      children.push(buildNode(child, depth + 1, nextBranch))
    }

    return {
      item,
      children,
      depth,
      ...(isOrphan ? { isOrphan: true } : {}),
    }
  }

  const roots: HierarchyTreeNode<T>[] = []
  for (const rootItem of candidateRoots) {
    const mId = getManagerId(rootItem)
    const isOrphan = Boolean(mId && !byId.has(mId))
    roots.push(buildNode(rootItem, 0, new Set(), isOrphan))
  }

  // If there are unvisited items (e.g. isolated circular loops with no external root),
  // defensively attach them as root orphans
  for (const item of items) {
    if (!visitedGlobal.has(item.id)) {
      orphanCount++
      roots.push(buildNode(item, 0, new Set(), true))
    }
  }

  roots.sort((a, b) => sortItems(a.item, b.item))

  return {
    roots,
    orphanCount,
    totalCount: items.length,
  }
}