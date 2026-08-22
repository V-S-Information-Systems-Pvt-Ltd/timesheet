// app/actions/user-actions.ts
'use server'

import { isNonEmpty, isOneOf, isValidEmail } from '@/lib/validation'
import { passwordSchema } from '@/lib/validation-schemas'
import { ROLES } from '@/app/constants'
import { repo } from '@/lib/db'
import { getActor } from '@/lib/auth'
import { logger } from '@/lib/logger'
import type { User, UserRole } from '@/app/types'
import { ActionResult, requireActor } from './_helpers'

export async function addUser(input: {
  email: string
  password: string
  name: string
  department: string
  title: string
  role: UserRole
  isActive: boolean
  /** Optional manager/team lead this user reports to. */
  managerId?: string | null
}): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  if (!isOneOf(input.role, ROLES)) {
    return { error: 'Invalid role.' }
  }
  if (!isNonEmpty(input.email)) {
    return { error: 'Email is required.' }
  }
  if (!isValidEmail(input.email)) {
    return { error: 'Please enter a valid email address.' }
  }
  const passwordCheck = passwordSchema.safeParse(input.password)
  if (!passwordCheck.success) {
    return { error: passwordCheck.error.issues[0]?.message ?? 'Invalid password.' }
  }

  const email = input.email.trim().toLowerCase()
  const result = await repo.createUser(gate.actor, {
    email,
    password: input.password,
    name: input.name.trim(),
    department: input.department.trim(),
    title: input.title.trim(),
    role: input.role,
    isActive: input.isActive,
    managerId: input.managerId || null,
  })

  if (!result.error) {
    const audit = await repo.writeAuditLog(gate.actor, {
      action: 'user.create',
      targetId: email,
      detail: { role: input.role, isActive: input.isActive },
    })
    if (audit.error) {
      logger.warn('audit log failed', { action: 'user.create', error: audit.error })
    }
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

  const result = await repo.updateUserStatus(actor, userId, !target.is_active)
  if (!result.error) {
    const audit = await repo.writeAuditLog(actor, {
      action: 'user.status_change',
      targetId: userId,
      detail: { isActive: !target.is_active },
    })
    if (audit.error) {
      logger.warn('audit log failed', { action: 'user.status_change', error: audit.error })
    }
  }
  return result.error ? { error: result.error } : {}
}

export async function updateUserRole(userId: string, role: UserRole): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  if (!isOneOf(role, ROLES)) return { error: 'Invalid role.' }
  if (actor.id === userId) return { error: 'You cannot change your own role.' }

  const result = await repo.updateUserRole(actor, userId, role)
  if (!result.error) {
    const audit = await repo.writeAuditLog(actor, {
      action: 'user.role_change',
      targetId: userId,
      detail: { role },
    })
    if (audit.error) {
      logger.warn('audit log failed', { action: 'user.role_change', error: audit.error })
    }
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
    const audit = await repo.writeAuditLog(actor, {
      action: 'user.manager_change',
      targetId: userId,
      detail: { managerId },
    })
    if (audit.error) {
      logger.warn('audit log failed', { action: 'user.manager_change', error: audit.error })
    }
  }
  return result.error ? { error: result.error } : {}
}

/** User edits their own department/title. */
export async function updateMyProfile(input: {
  department: string
  title: string
}): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }

  const result = await repo.updateMyProfile(actor, {
    department: input.department.trim(),
    title: input.title.trim(),
  })
  return result.error ? { error: result.error } : {}
}
