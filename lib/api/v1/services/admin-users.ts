import 'server-only'

import type { Actor } from '@/lib/db/types'
import type { AdminPasswordResetResult, HierarchyRole, PermissionRole, User } from '@/app/types'
import { isAdminActor, isSuperAdminActor, isSuperAdminEmail } from '@/lib/roles'
import { safeAudit } from '@/lib/audit'
import { generatePassword } from '@/lib/auth/password'
import { canManageUser } from '@/lib/db/native/visibility'
import { issuePasswordResetToken, setPasswordByAdmin } from '@/lib/db/password-recovery'
import { sendPasswordResetEmail } from '@/lib/email/password-reset'
import { extractError, logger } from '@/lib/logger'
import { peopleDeps } from '@/lib/db/people'
import {
  createPersonDomain,
  listPeopleDomain,
  updatePersonDomain,
  type UpdatePersonPatch,
} from '@/lib/domain/people'
import type { MobileServiceResult } from './_result'

/**
 * Mobile user-administration transport. Gate + parse the HTTP payload here, then
 * delegate policy/validation/persistence to the people application service. Wire
 * shapes and error codes/statuses are preserved from the previous inline routes.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validateAdminUserStateFields(
  record: Record<string, unknown>
): MobileServiceResult<never> | null {
  if ('isActive' in record && typeof record.isActive !== 'boolean') {
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'isActive must be a boolean.',
      status: 400,
      fieldErrors: { isActive: ['isActive must be a boolean.'] },
    }
  }
  if (
    'managerId' in record &&
    record.managerId !== null &&
    typeof record.managerId !== 'string'
  ) {
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'managerId must be a string or null.',
      status: 400,
      fieldErrors: { managerId: ['managerId must be a string or null.'] },
    }
  }
  return null
}

export async function listAdminUsersService(
  actor: Actor
): Promise<MobileServiceResult<User[]>> {
  if (!isAdminActor(actor)) {
    return {
      success: false,
      code: 'FORBIDDEN',
      message: 'Only administrators can view user administration.',
      status: 403,
    }
  }

  const result = await listPeopleDomain(actor, peopleDeps())
  if (!result.ok) {
    return { success: false, code: 'FORBIDDEN', message: result.error.message, status: 403 }
  }
  return { success: true, data: result.data }
}

export async function createAdminUserService(
  actor: Actor,
  body: unknown
): Promise<MobileServiceResult<User | null>> {
  if (!isAdminActor(actor)) {
    return {
      success: false,
      code: 'FORBIDDEN',
      message: 'Only administrators can create users.',
      status: 403,
    }
  }

  const record = isRecord(body) ? body : {}
  const invalidState = validateAdminUserStateFields(record)
  if (invalidState) return invalidState
  const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : ''
  const password = typeof record.password === 'string' ? record.password : ''
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const department = typeof record.department === 'string' ? record.department.trim() : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const permissionRole = (record.permissionRole || 'user') as PermissionRole
  // Preserve the original default handling: only a truthy provided role counts
  // for the title-consistency check; otherwise the title classification wins.
  const hierarchyRole = record.hierarchyRole
    ? (record.hierarchyRole as HierarchyRole)
    : undefined
  const isActive = typeof record.isActive === 'boolean' ? record.isActive : true
  const managerId = record.managerId === null
    ? null
    : typeof record.managerId === 'string'
      ? record.managerId.trim() || null
      : null

  const result = await createPersonDomain(
    actor,
    {
      email,
      password,
      name,
      department,
      title,
      permissionRole,
      hierarchyRole,
      isActive,
      managerId,
    },
    peopleDeps()
  )

  if (!result.ok) {
    if (result.error.code === 'CONFLICT') {
      return { success: false, code: 'CONFLICT', message: result.error.message, status: 409 }
    }
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: result.error.message,
      status: 400,
    }
  }

  const profiles = await listPeopleDomain(actor, peopleDeps())
  const created = profiles.ok ? profiles.data.find((p) => p.email === email) ?? null : null
  return { success: true, data: created, status: 201 }
}

/**
 * Build the presence-aware patch from a raw JSON body, mirroring the previous
 * route's `'field' in body` semantics (undefined = unchanged, null = clear).
 */
export function buildUpdatePatch(body: unknown): UpdatePersonPatch {
  const record = isRecord(body) ? body : {}
  const patch: UpdatePersonPatch = {}
  if ('name' in record) {
    patch.name = typeof record.name === 'string' ? record.name.trim() : ''
  }
  if ('department' in record) {
    patch.department = typeof record.department === 'string' ? record.department.trim() || null : null
  }
  if ('isActive' in record && typeof record.isActive === 'boolean') {
    patch.isActive = record.isActive
  }
  if ('permissionRole' in record) {
    patch.permissionRole = record.permissionRole as PermissionRole
  }
  if ('hierarchyRole' in record) {
    patch.hierarchyRole = record.hierarchyRole as HierarchyRole
  }
  if ('title' in record) {
    patch.title = typeof record.title === 'string' ? record.title.trim() || null : null
  }
  if ('managerId' in record) {
    if (record.managerId === null) patch.managerId = null
    else if (typeof record.managerId === 'string') patch.managerId = record.managerId.trim() || null
  }
  return patch
}

export async function updateAdminUserService(
  actor: Actor,
  targetId: string,
  body: unknown
): Promise<MobileServiceResult<User | null>> {
  if (!isAdminActor(actor)) {
    return {
      success: false,
      code: 'FORBIDDEN',
      message: 'Only administrators can update users.',
      status: 403,
    }
  }
  if (!targetId) {
    return { success: false, code: 'VALIDATION_ERROR', message: 'User ID is required.', status: 400 }
  }

  const record = isRecord(body) ? body : {}
  const invalidState = validateAdminUserStateFields(record)
  if (invalidState) return invalidState

  const result = await updatePersonDomain(actor, targetId, buildUpdatePatch(record), peopleDeps())
  if (!result.ok) {
    const { code, message } = result.error
    if (code === 'NOT_FOUND') return { success: false, code: 'NOT_FOUND', message, status: 404 }
    if (code === 'FORBIDDEN') return { success: false, code: 'FORBIDDEN', message, status: 403 }
    // Write failures surface as BAD_REQUEST (400), matching the previous route;
    // validation failures keep the VALIDATION_ERROR code.
    if (code === 'STORAGE_ERROR') {
      return { success: false, code: 'BAD_REQUEST', message, status: 400 }
    }
    return { success: false, code: 'VALIDATION_ERROR', message, status: 400 }
  }

  return { success: true, data: result.data }
}


/**
 * Admin password reset for another user: email them a reset link, or set a
 * random password the admin passes on. Either way only managers of the target
 * (canManageUser) may do it, and only the super-admin may touch that account.
 */
export async function adminPasswordResetService(
  actor: Actor,
  targetId: string,
  body: unknown
): Promise<MobileServiceResult<AdminPasswordResetResult>> {
  if (!isAdminActor(actor)) {
    return { success: false, code: 'FORBIDDEN', message: 'Only administrators can reset passwords.', status: 403 }
  }
  const mode = isRecord(body) ? body.mode : undefined
  if (mode !== 'email' && mode !== 'generate') {
    return { success: false, code: 'VALIDATION_ERROR', message: 'mode must be "email" or "generate".', status: 400 }
  }

  const target = targetId ? await peopleDeps().persistence.getProfileById(targetId) : null
  if (!target) return { success: false, code: 'NOT_FOUND', message: 'User not found.', status: 404 }
  if (target.id === actor.id) {
    return { success: false, code: 'VALIDATION_ERROR', message: 'Use Change password for your own account.', status: 400 }
  }
  if ((isSuperAdminEmail(target.email) && !isSuperAdminActor(actor)) || !(await canManageUser(actor, target.id))) {
    return { success: false, code: 'FORBIDDEN', message: "You cannot reset this user's password.", status: 403 }
  }

  if (mode === 'email') {
    const issued = await issuePasswordResetToken(target.email)
    if (!issued) return { success: false, code: 'NOT_FOUND', message: 'User not found.', status: 404 }
    try {
      await sendPasswordResetEmail({ to: issued.email, token: issued.token, expiresAt: issued.expiresAt })
    } catch (err) {
      logger.error('admin password reset email delivery failed', { targetId: target.id, error: extractError(err) })
      return {
        success: false,
        code: 'EMAIL_FAILED',
        message: 'Could not send the reset email. Generate a password instead.',
        status: 502,
      }
    }
    await safeAudit(actor, { action: 'user.password_reset_email', targetId: target.id })
    return { success: true, data: { mode, email: issued.email } }
  }

  const password = generatePassword()
  if (!(await setPasswordByAdmin(target.id, password))) {
    return { success: false, code: 'NOT_FOUND', message: 'User not found.', status: 404 }
  }
  await safeAudit(actor, { action: 'user.password_generated', targetId: target.id })
  return { success: true, data: { mode, password } }
}
