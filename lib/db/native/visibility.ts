// lib/db/native/visibility.ts
// Test users are visible only to the super admin (and to themselves).
import 'server-only'

import { canSeeAllActor, isLeaderActor, isSuperAdminActor } from '@/lib/roles'
import type { Actor } from '@/lib/db/types'

/** SQL predicate hiding test users' rows, or null when the actor sees them.
 * Pushes the actor id onto `params`. */
export function hideTestUsersClause(actor: Actor, userIdColumn: string, params: unknown[]): string | null {
  if (isSuperAdminActor(actor)) return null
  params.push(actor.id)
  return `(${userIdColumn} = $${params.length} or not exists (select 1 from public.profiles tu where tu.id = ${userIdColumn} and tu.is_test_user))`
}

/** Timesheet read scope (alias `t`): own rows, a leader's team, or all;
 * test users hidden unless the actor is the super admin. */
export function timesheetScope(actor: Actor): { where: string; params: unknown[] } {
  if (!canSeeAllActor(actor) && !isLeaderActor(actor)) return { where: 'where t.user_id = $1', params: [actor.id] }
  const params: unknown[] = []
  const conds: string[] = []
  const hidden = hideTestUsersClause(actor, 't.user_id', params)
  if (hidden) conds.push(hidden)
  if (!canSeeAllActor(actor)) {
    params.push(actor.id)
    conds.push(`(t.user_id = $${params.length} or t.user_id = any(public.team_ids($${params.length})))`)
  }
  return { where: conds.length ? `where ${conds.join(' and ')}` : '', params }
}
