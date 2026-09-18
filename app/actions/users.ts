// app/actions/users.ts
// Server Actions for user profile, role, and reporting line operations.
// Thin transport layer: authenticate/authorize, then delegate to the people
// application service (lib/domain/people.ts) through the narrow people ports.
'use server'

import type { HierarchyRole, PermissionRole } from '@/app/types'
import { peopleDeps } from '@/lib/db/people'
import {
  createPersonDomain,
  setPersonManagerDomain,
  togglePersonStatusDomain,
  updateOwnProfileDomain,
  updatePersonDepartmentDomain,
  updatePersonHierarchyDomain,
  updatePersonNameDomain,
  updatePersonRolesDomain,
} from '@/lib/domain/people'
import { type ActionResult, requireActiveActor, requireActor } from './_shared'

export async function addUser(input: {
  email: string
  password: string
  name: string
  department: string
  title: string
  permissionRole: PermissionRole
  hierarchyRole: HierarchyRole
  isActive: boolean
  /** Optional manager/team lead this user reports to. */
  managerId?: string | null
}): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await createPersonDomain(gate.actor, input, peopleDeps())
  if (result.ok) return {}
  if (result.error.details?.reason === 'missing_credentials') {
    return { error: 'Email and a password are required.' }
  }
  return { error: result.error.message }
}

export async function toggleUserStatus(userId: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await togglePersonStatusDomain(gate.actor, userId, peopleDeps())
  return result.ok ? {} : { error: result.error.message }
}

export async function updateUserRoles(
  userId: string,
  permissionRole: PermissionRole,
  hierarchyRole: HierarchyRole
): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await updatePersonRolesDomain(
    gate.actor,
    userId,
    permissionRole,
    hierarchyRole,
    peopleDeps()
  )
  return result.ok ? {} : { error: result.error.message }
}

/** Admin-only: change a user's full name. */
export async function updateUserName(userId: string, name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await updatePersonNameDomain(gate.actor, userId, name, peopleDeps())
  return result.ok ? {} : { error: result.error.message }
}

/** Admin-only: change or clear a user's department. */
export async function updateUserDepartment(userId: string, department: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await updatePersonDepartmentDomain(gate.actor, userId, department, peopleDeps())
  return result.ok ? {} : { error: result.error.message }
}

/**
 * Admin-only: set who a user reports to (manager or team lead).
 * Guards against self-assignment and reporting cycles.
 */
export async function setUserManager(
  userId: string,
  managerId: string | null
): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await setPersonManagerDomain(gate.actor, userId, managerId, peopleDeps())
  return result.ok ? {} : { error: result.error.message }
}

/** User edits their own department/title. */
export async function updateMyProfile(input: {
  department: string
  title: string
}): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }

  const result = await updateOwnProfileDomain(gate.actor, input, peopleDeps())
  return result.ok ? {} : { error: result.error.message }
}

// --- hierarchy & reporting structure (admin, hierarchy axis) ---

export async function updateUserHierarchy(
  userId: string,
  data: { managerId: string | null; title?: string; hierarchyRole?: HierarchyRole }
): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await updatePersonHierarchyDomain(gate.actor, userId, data, peopleDeps())
  return result.ok ? {} : { error: result.error.message }
}
