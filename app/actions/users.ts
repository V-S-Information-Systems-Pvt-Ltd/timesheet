// app/actions/users.ts
// Server Actions for user profile, role, and reporting line operations.
'use server'

import { isNonEmpty, isOneOf, isValidEmail } from '@/lib/validation'
import { passwordSchema } from '@/lib/validation-schemas'
import { repo } from '@/lib/db'
import { HIERARCHY_ROLES, PERMISSION_ROLES } from '@/lib/roles'
import { wouldCreateHierarchyCycle } from '@/lib/hierarchy'
import { roleForTitle } from '@/app/constants'
import type { HierarchyRole, PermissionRole, User } from '@/app/types'
import { type ActionResult, requireActiveActor, requireActor, safeAudit } from './_shared'

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

  if (!isOneOf(input.permissionRole, PERMISSION_ROLES)) {
    return { error: 'Invalid permission role.' }
  }
  if (!isOneOf(input.hierarchyRole, HIERARCHY_ROLES)) {
    return { error: 'Invalid hierarchy role.' }
  }
  if (!isNonEmpty(input.email) || !isNonEmpty(input.password)) {
    return { error: 'Email and a password are required.' }
  }
  // Temp passwords are live credentials — same policy as self-signup.
  const pwdCheck = passwordSchema.safeParse(input.password)
  if (!pwdCheck.success) {
    return { error: pwdCheck.error.issues[0]?.message ?? 'Password does not meet complexity requirements.' }
  }
  if (!isValidEmail(input.email)) {
    return { error: 'Please enter a valid email address.' }
  }

  const email = input.email.trim().toLowerCase()
  const result = await repo.createUser(gate.actor, {
    email,
    password: input.password,
    name: input.name.trim(),
    department: input.department.trim(),
    title: input.title.trim(),
    permissionRole: input.permissionRole,
    hierarchyRole: input.hierarchyRole,
    isActive: input.isActive,
    managerId: input.managerId || null,
  })

  if (!result.error) {
    await safeAudit(gate.actor, {
      action: 'user.create',
      detail: { email, permissionRole: input.permissionRole, hierarchyRole: input.hierarchyRole },
    })
  }

  return result.error ? { error: result.error } : {}
}

export async function toggleUserStatus(userId: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  const target = await repo.getProfileById(userId)
  if (!target) return { error: 'User not found.' }

  if (actor.id === userId && target.is_active) {
    return { error: 'You cannot deactivate your own account.' }
  }

  const newStatus = !target.is_active
  const result = await repo.updateUserStatus(actor, userId, newStatus)
  if (!result.error) {
    await safeAudit(actor, {
      action: 'user.status_change',
      targetId: userId,
      detail: { isActive: newStatus },
    })
  }
  return result.error ? { error: result.error } : {}
}

export async function updateUserRoles(
  userId: string,
  permissionRole: PermissionRole,
  hierarchyRole: HierarchyRole
): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  if (!isOneOf(permissionRole, PERMISSION_ROLES)) return { error: 'Invalid permission role.' }
  if (!isOneOf(hierarchyRole, HIERARCHY_ROLES)) return { error: 'Invalid hierarchy role.' }
  if (actor.id === userId) return { error: 'You cannot change your own roles.' }

  const result = await repo.updateUserRoles(actor, userId, permissionRole, hierarchyRole)
  if (!result.error) {
    await safeAudit(actor, {
      action: 'user.role_change',
      targetId: userId,
      detail: { permissionRole, hierarchyRole },
    })
  }
  return result.error ? { error: result.error } : {}
}

/** Admin-only: change a user's full name. */
export async function updateUserName(userId: string, name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  if (!isNonEmpty(name)) return { error: 'Name is required.' }

  const result = await repo.updateUserName(gate.actor, userId, name.trim())
  return result.error ? { error: result.error } : {}
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
  const actor = gate.actor

  if (userId === actor.id) return { error: 'You cannot change your own reporting line.' }
  if (managerId === userId) return { error: 'A user cannot report to themselves.' }

  if (managerId) {
    // Cycle guard: walk the manager chain upward from the proposed manager; if
    // it ever reaches `userId`, assigning would create a loop.
    const users = await repo.listProfiles(actor)
    const byId = new Map(users.map(u => [u.id, u]))
    let current: User | undefined = byId.get(managerId)
    const seen = new Set<string>()
    while (current && current.manager_id && !seen.has(current.id)) {
      if (current.manager_id === userId) {
        return { error: 'That assignment would create a reporting cycle.' }
      }
      seen.add(current.id)
      current = byId.get(current.manager_id)
    }
  }

  const result = await repo.updateUserManager(actor, userId, managerId)
  if (!result.error) {
    await safeAudit(actor, {
      action: 'user.manager_change',
      targetId: userId,
      detail: { managerId },
    })
  }
  return result.error ? { error: result.error } : {}
}

/** User edits their own department/title. */
export async function updateMyProfile(input: {
  department: string
  title: string
}): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }

  const result = await repo.updateMyProfile(gate.actor, {
    department: input.department.trim(),
    title: input.title.trim(),
  })
  return result.error ? { error: result.error } : {}
}

// --- hierarchy & reporting structure (admin, hierarchy axis) ---

export async function updateUserHierarchy(
  userId: string,
  data: { managerId: string | null; title?: string; hierarchyRole?: HierarchyRole }
): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  if (!userId) return { error: 'User ID is required.' }
  if (data.hierarchyRole !== undefined && !isOneOf(data.hierarchyRole, HIERARCHY_ROLES)) {
    return { error: 'Invalid hierarchy role.' }
  }

  const targetUser = await repo.getProfileById(userId)
  if (!targetUser) return { error: 'User not found.' }

  // Determine the hierarchy role: if the title is updated and no hierarchy
  // role is explicitly provided, auto-sync it from the title. The permission
  // axis is never touched by this action.
  let targetHierarchyRole = data.hierarchyRole
  if (data.title && !targetHierarchyRole) {
    targetHierarchyRole = roleForTitle(data.title)
  }

  // Reject a contradictory title+hierarchy-role save (e.g. title "Manager"
  // with hierarchy role "user").
  const effectiveTitle = data.title !== undefined ? data.title : targetUser.title
  if (
    data.hierarchyRole !== undefined &&
    effectiveTitle &&
    roleForTitle(effectiveTitle) !== data.hierarchyRole
  ) {
    return {
      error: `Hierarchy role "${data.hierarchyRole}" is inconsistent with the title "${effectiveTitle}". Set the title to "Manager" or "Team Lead" to grant a leadership role.`,
    }
  }

  const selfEdit = userId === gate.actor.id
  if (selfEdit) {
    if (targetHierarchyRole && targetHierarchyRole !== targetUser.hierarchy_role) {
      return { error: 'You cannot change your own role.' }
    }
    if (data.managerId !== undefined && data.managerId !== targetUser.manager_id) {
      return { error: 'You cannot change your own reporting line.' }
    }
  }

  // Check for circular hierarchy loop
  if (data.managerId) {
    const allUsers = await repo.listProfiles(gate.actor)
    if (wouldCreateHierarchyCycle(allUsers, userId, data.managerId)) {
      return { error: 'Invalid reporting line: assigning this manager creates a circular reporting loop.' }
    }
  }

  const result = await repo.updateUserHierarchy(gate.actor, userId, {
    managerId: data.managerId,
    title: data.title,
    hierarchyRole: targetHierarchyRole,
  })

  if (!result.error) {
    await safeAudit(gate.actor, {
      action: 'user.hierarchy_update',
      targetId: userId,
      detail: { managerId: data.managerId, title: data.title, hierarchyRole: targetHierarchyRole },
    })
  }

  return result.error ? { error: result.error } : {}
}
