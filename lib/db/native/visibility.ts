// lib/db/native/visibility.ts
// Row visibility shared by native adapters: test users (visible only to the
// super admin and themselves) and the admin/CO department boundary.
import 'server-only'

import { departmentScope, isAdminActor, isLeaderActor, canSeeAllActor, isSuperAdminActor } from '@/lib/roles'
import type { Actor } from '@/lib/db/types'
import { query } from '../pool'

/** SQL predicate limiting `userIdColumn` to users the actor may reach beyond
 * their own role rules: themselves, or a non-test user inside the actor's
 * department scope (an admin/CO limit; others have none). Always a predicate,
 * `true` for the super admin. `departments: false` skips the department limit
 * (org-wide directory). Pushes its parameters onto `params`. */
export function visibleUserClause(actor: Actor, userIdColumn: string, params: unknown[], { departments = true } = {}): string {
  if (isSuperAdminActor(actor)) return 'true'
  params.push(actor.id)
  const self = `$${params.length}`
  const conds = ['not vu.is_test_user']
  const scope = departments ? departmentScope(actor) : null
  if (scope) {
    params.push(scope)
    conds.push(`vu.department = any($${params.length}::text[])`)
  }
  // `in` keeps userIdColumn outside the subquery: inside it, an unqualified
  // `id` would bind to `vu.id` and make the predicate always true.
  return `(${userIdColumn} = ${self} or ${userIdColumn} in (select vu.id from public.profiles vu where ${conds.join(' and ')}))`
}

/** Timesheet read scope (alias `t`): own rows, a leader's team, or all,
 * narrowed by visibleUserClause. */
export function timesheetScope(actor: Actor): { where: string; params: unknown[] } {
  if (!canSeeAllActor(actor) && !isLeaderActor(actor)) return { where: 'where t.user_id = $1', params: [actor.id] }
  const params: unknown[] = []
  const conds = [visibleUserClause(actor, 't.user_id', params)]
  if (!canSeeAllActor(actor)) {
    params.push(actor.id)
    conds.push(`(t.user_id = $${params.length} or t.user_id = any(public.team_ids($${params.length})))`)
  }
  return { where: `where ${conds.join(' and ')}`, params }
}

/** True when the user is the actor or inside the actor's department scope. */
export async function userInScope(actor: Actor, userId: string): Promise<boolean> {
  if (userId === actor.id) return true
  const scope = departmentScope(actor)
  if (!scope) return true
  const rows = await query<{ ok: boolean }>('select true as ok from public.profiles where id = $1 and department = any($2) limit 1', [userId, scope])
  return rows.length > 0
}

/** Admin-management check: department-limited admins only manage pm/user
 * accounts inside their scope, so they cannot reach or create other admins. */
export async function canManageUser(actor: Actor, userId: string): Promise<boolean> {
  if (!isAdminActor(actor)) return false
  const scope = departmentScope(actor)
  if (!scope) return true
  const rows = await query<{ ok: boolean }>(
    "select true as ok from public.profiles where id = $1 and department = any($2) and permission_role in ('pm', 'user') limit 1",
    [userId, scope]
  )
  return rows.length > 0
}
