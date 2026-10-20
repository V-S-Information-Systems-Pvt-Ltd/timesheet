// lib/db/native/visibility.ts
// Row visibility shared by native adapters: test users (visible only to the
// super admin and themselves) and the admin/CO department boundary.
import 'server-only'

import { canSeeAllActor, isAdminActor, isLeaderActor, isSuperAdminActor } from '@/lib/roles'
import type { Actor } from '@/lib/db/types'
import { query } from '../pool'

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
  const department = departmentScopeClause(actor, 't.user_id', params)
  if (department && department !== 'true') conds.push(department)
  if (!canSeeAllActor(actor)) {
    params.push(actor.id)
    conds.push(`(t.user_id = $${params.length} or t.user_id = any(public.team_ids($${params.length})))`)
  }
  return { where: conds.length ? `where ${conds.join(' and ')}` : '', params }
}

// --- department boundary -----------------------------------------------------
// An admin or CO with a non-empty profiles.scope_departments only reaches users
// in those departments (and themselves). The scope is read from the profile row
// on every check, so a change takes effect without a new session.

/** SQL predicate limiting `userIdColumn` to the actor's department scope, or
 * null when the actor is not an admin/CO (their own rules apply). Pushes actor.id. */
export function departmentScopeClause(actor: Actor, userIdColumn: string, params: unknown[]): string | null {
  if (!canSeeAllActor(actor)) return null
  if (isSuperAdminActor(actor)) return 'true'
  params.push(actor.id)
  const a = `$${params.length}`
  return `(${userIdColumn} = ${a} or exists (select 1 from public.profiles sa where sa.id = ${a}
    and (coalesce(cardinality(sa.scope_departments), 0) = 0
      or exists (select 1 from public.profiles su where su.id = ${userIdColumn} and su.department = any(sa.scope_departments)))))`
}

/** The actor's department limit, or null when unrestricted. */
export async function departmentScope(actor: Actor): Promise<string[] | null> {
  if (!canSeeAllActor(actor) || isSuperAdminActor(actor)) return null
  const rows = await query<{ scope: string[] | null }>('select scope_departments as scope from public.profiles where id = $1', [actor.id])
  const scope = rows[0]?.scope
  return scope && scope.length > 0 ? scope : null
}

/** Admin with no department limit: may change org-wide setup. */
export async function isOrgAdmin(actor: Actor): Promise<boolean> {
  return isAdminActor(actor) && (await departmentScope(actor)) === null
}

/** True when the user is the actor or inside the actor's department scope. */
export async function userInScope(actor: Actor, userId: string): Promise<boolean> {
  if (userId === actor.id) return true
  const scope = await departmentScope(actor)
  if (!scope) return true
  const rows = await query<{ ok: boolean }>('select true as ok from public.profiles where id = $1 and department = any($2) limit 1', [userId, scope])
  return rows.length > 0
}

/** Admin-management check: department-limited admins only manage pm/user
 * accounts inside their scope, so they cannot reach or create other admins. */
export async function canManageUser(actor: Actor, userId: string): Promise<boolean> {
  if (!isAdminActor(actor)) return false
  const scope = await departmentScope(actor)
  if (!scope) return true
  const rows = await query<{ ok: boolean }>(
    "select true as ok from public.profiles where id = $1 and department = any($2) and permission_role in ('pm', 'user') limit 1",
    [userId, scope]
  )
  return rows.length > 0
}
