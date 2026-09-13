import 'server-only'

import type { Actor, CreateUserInput, UpdateUserInput } from '@/lib/db/repository'
import type { HierarchyRole, PermissionRole, TitleRecord, User } from '@/app/types'
import { isNonEmpty, isOneOf, isValidEmail } from '@/lib/validation'
import { passwordSchema } from '@/lib/validation-schemas'
import { roleForTitle } from '@/app/constants'
import { logger, extractError } from '@/lib/logger'
import {
  HIERARCHY_ROLES,
  PERMISSION_ROLES,
  canSeeAllActor,
  canViewTeamActor,
  isAdminActor,
  isLeaderActor,
  isLeaderHierarchy,
  legacyRoleFromPair,
  rolePairFromLegacy,
  getActorCapabilities,
  type ActorCapabilities,
} from '@/lib/roles'
import {
  buildHierarchyTree,
  isLeader,
  leaderUsers,
  reportToOptions,
  wouldCreateHierarchyCycle,
} from '@/lib/hierarchy'
import type { PeoplePorts } from './people-port'

/**
 * People application service. One authoritative implementation of the profile,
 * capability, reporting-hierarchy and account-administration rules, shared by
 * the Server Actions, `/api/data` and `/api/v1` transports.
 *
 * The two role axes stay independent: permission_role authorizes, hierarchy_role
 * positions the person in the reporting tree. Titles only ever affect the
 * hierarchy axis (via `roleForTitle`); the permission axis is never derived from
 * a title. The legacy combined `role` column is recomputed by the persistence
 * adapters, never here.
 *
 * Provider identity creation and the credential lifecycle stay behind the
 * `PeopleIdentity` boundary; this module only orchestrates validation, policy,
 * persistence and audit.
 */

// --- pure, platform-neutral rules ------------------------------------------
//
// These are the canonical capability/hierarchy calculations. They are re-
// exported here so web and any future shared consumer read one definition.
// Follow-up (coordinator): these pure functions belong in `@vsis/core` so mobile
// can consume them too; that package is owned by the shared-packages slice, so
// slice 05 keeps them in this server service and points web at this module.

export {
  HIERARCHY_ROLES,
  PERMISSION_ROLES,
  canSeeAllActor,
  canViewTeamActor,
  isAdminActor,
  isLeaderActor,
  isLeaderHierarchy,
  legacyRoleFromPair,
  rolePairFromLegacy,
  getActorCapabilities,
  buildHierarchyTree,
  isLeader,
  leaderUsers,
  reportToOptions,
  wouldCreateHierarchyCycle,
}
export type { ActorCapabilities }

export type PeopleDomainErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'STORAGE_ERROR'

export interface PeopleDomainError {
  code: PeopleDomainErrorCode
  message: string
  /** Transport-visible reason for cases where web and mobile word the same
   *  failure differently (e.g. missing credentials). */
  details?: { reason?: string }
}

export type PeopleDomainResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: PeopleDomainError }

function fail<T>(
  code: PeopleDomainErrorCode,
  message: string,
  details?: PeopleDomainError['details']
): PeopleDomainResult<T> {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } }
}

function succeed<T>(data: T): PeopleDomainResult<T> {
  return { ok: true, data }
}

/** Load title records, degrading to the built-in classification on failure. */
async function loadTitles(
  deps: PeoplePorts,
  warnMessage: string,
  meta: Record<string, unknown>
): Promise<TitleRecord[]> {
  try {
    return await deps.persistence.listTitleRecords()
  } catch (err) {
    logger.warn(warnMessage, { error: extractError(err), ...meta })
    return []
  }
}

/** Best-effort audit logging that never fails the user mutation. */
async function safeAudit(
  deps: PeoplePorts,
  actor: Actor,
  entry: { action: string; targetId?: string; detail?: Record<string, unknown> }
): Promise<void> {
  try {
    await deps.persistence.writeAuditLog(actor, entry)
  } catch (err) {
    logger.error('audit log write failed', { action: entry.action, error: extractError(err) })
  }
}

/**
 * Best-effort audit used by account administration where a failed write is
 * logged with the transport's established warning instead of the shared one.
 */
async function auditOrWarn(
  deps: PeoplePorts,
  actor: Actor,
  entry: { action: string; targetId?: string; detail?: Record<string, unknown> },
  warnMessage: string,
  targetId: string
): Promise<void> {
  try {
    await deps.persistence.writeAuditLog(actor, entry)
  } catch (err) {
    logger.warn(warnMessage, { error: extractError(err), targetId })
  }
}

// --- profiles ---------------------------------------------------------------

/**
 * List profiles visible to the actor (admin/co see all; manager/team-lead see
 * their reporting subtree; everyone else is forbidden). The persistence adapter
 * enforces the provider-specific scoping (SQL / RLS).
 */
export async function listPeopleDomain(
  actor: Actor,
  deps: PeoplePorts
): Promise<PeopleDomainResult<User[]>> {
  if (!canViewTeamActor(actor)) {
    return fail('FORBIDDEN', 'You do not have permission to perform this action.')
  }
  const profiles = await deps.persistence.listProfiles(actor)
  return succeed(profiles)
}

/** The actor's own profile, read directly by id. */
export async function getSelfProfileDomain(
  actor: Actor,
  deps: PeoplePorts
): Promise<PeopleDomainResult<User | null>> {
  return succeed(await deps.persistence.getProfileById(actor.id))
}

// --- account administration -------------------------------------------------

export interface CreatePersonInput {
  email: string
  password: string
  name: string
  department: string
  title: string
  permissionRole: PermissionRole
  /** Raw caller-supplied hierarchy role; absent means "derive from title/user". */
  hierarchyRole?: HierarchyRole
  isActive: boolean
  managerId?: string | null
}

/**
 * Admin provisioning: validate the request, resolve the hierarchy role from the
 * title (the permission axis is untouched), then hand credential + profile
 * creation to the identity boundary as one provider-atomic operation.
 */
export async function createPersonDomain(
  actor: Actor,
  input: CreatePersonInput,
  deps: PeoplePorts
): Promise<PeopleDomainResult<{ id?: string }>> {
  if (!isAdminActor(actor)) {
    return fail('FORBIDDEN', 'You do not have permission to perform this action.')
  }
  if (!isOneOf(input.permissionRole, PERMISSION_ROLES)) {
    return fail('VALIDATION_ERROR', 'Invalid permission role.')
  }
  if (input.hierarchyRole !== undefined && !isOneOf(input.hierarchyRole, HIERARCHY_ROLES)) {
    return fail('VALIDATION_ERROR', 'Invalid hierarchy role.')
  }
  if (!isNonEmpty(input.email) || !isNonEmpty(input.password)) {
    // The versioned mobile route words this failure differently from the web
    // action; transports map on `details.reason` to keep both wire messages.
    return fail('VALIDATION_ERROR', 'Email and password are required.', {
      reason: 'missing_credentials',
    })
  }
  // Temp passwords are live credentials — same policy as self-signup.
  const pwdCheck = passwordSchema.safeParse(input.password)
  if (!pwdCheck.success) {
    return fail(
      'VALIDATION_ERROR',
      pwdCheck.error.issues[0]?.message ?? 'Password does not meet complexity requirements.'
    )
  }
  if (!isValidEmail(input.email)) {
    return fail('VALIDATION_ERROR', 'Please enter a valid email address.')
  }

  const email = input.email.trim().toLowerCase()
  const cleanTitle = input.title.trim()
  let effectiveHierarchyRole: HierarchyRole = input.hierarchyRole ?? 'user'
  if (cleanTitle) {
    const titles = await loadTitles(deps, 'Failed to load title records for user creation', {})
    const titleClassification = roleForTitle(cleanTitle, titles)
    if (input.hierarchyRole && input.hierarchyRole !== titleClassification) {
      return fail(
        'VALIDATION_ERROR',
        `Hierarchy role "${input.hierarchyRole}" is inconsistent with the title "${cleanTitle}".`
      )
    }
    effectiveHierarchyRole = titleClassification
  }

  const identityInput: CreateUserInput = {
    email,
    password: input.password,
    name: input.name.trim(),
    department: input.department.trim(),
    title: cleanTitle,
    permissionRole: input.permissionRole,
    hierarchyRole: effectiveHierarchyRole,
    isActive: input.isActive,
    managerId: input.managerId || null,
  }

  const result = await deps.identity.createAccount(actor, identityInput)
  if (result.error) {
    return fail('CONFLICT', result.error)
  }

  await safeAudit(deps, actor, {
    action: 'user.create',
    detail: {
      email,
      permissionRole: input.permissionRole,
      hierarchyRole: effectiveHierarchyRole,
    },
  })

  return succeed({ id: result.id })
}

/** Admin: flip a user's active flag (self-deactivation is rejected). */
export async function togglePersonStatusDomain(
  actor: Actor,
  userId: string,
  deps: PeoplePorts
): Promise<PeopleDomainResult<{ isActive: boolean }>> {
  if (!isAdminActor(actor)) {
    return fail('FORBIDDEN', 'You do not have permission to perform this action.')
  }
  const target = await deps.persistence.getProfileById(userId)
  if (!target) return fail('NOT_FOUND', 'User not found.')
  if (actor.id === userId && target.is_active) {
    return fail('VALIDATION_ERROR', 'You cannot deactivate your own account.')
  }

  const newStatus = !target.is_active
  const result = await deps.persistence.updateUserStatus(actor, userId, newStatus)
  if (result.error) return fail('STORAGE_ERROR', result.error)

  await safeAudit(deps, actor, {
    action: 'user.status_change',
    targetId: userId,
    detail: { isActive: newStatus },
  })
  return succeed({ isActive: newStatus })
}

/** Admin: replace both role axes for a user (never your own). */
export async function updatePersonRolesDomain(
  actor: Actor,
  userId: string,
  permissionRole: PermissionRole,
  hierarchyRole: HierarchyRole,
  deps: PeoplePorts
): Promise<PeopleDomainResult<Record<string, never>>> {
  if (!isAdminActor(actor)) {
    return fail('FORBIDDEN', 'You do not have permission to perform this action.')
  }
  if (!isOneOf(permissionRole, PERMISSION_ROLES)) {
    return fail('VALIDATION_ERROR', 'Invalid permission role.')
  }
  if (!isOneOf(hierarchyRole, HIERARCHY_ROLES)) {
    return fail('VALIDATION_ERROR', 'Invalid hierarchy role.')
  }
  if (actor.id === userId) {
    return fail('VALIDATION_ERROR', 'You cannot change your own roles.')
  }

  const result = await deps.persistence.updateUserRoles(actor, userId, permissionRole, hierarchyRole)
  if (result.error) return fail('STORAGE_ERROR', result.error)

  await safeAudit(deps, actor, {
    action: 'user.role_change',
    targetId: userId,
    detail: { permissionRole, hierarchyRole },
  })
  return succeed({})
}

/** Admin: change a user's full name. */
export async function updatePersonNameDomain(
  actor: Actor,
  userId: string,
  name: string,
  deps: PeoplePorts
): Promise<PeopleDomainResult<Record<string, never>>> {
  if (!isAdminActor(actor)) {
    return fail('FORBIDDEN', 'You do not have permission to perform this action.')
  }
  if (!isNonEmpty(name)) return fail('VALIDATION_ERROR', 'Name is required.')

  const result = await deps.persistence.updateUserName(actor, userId, name.trim())
  if (result.error) return fail('STORAGE_ERROR', result.error)
  return succeed({})
}

/** Admin: change or clear a user's department (through the atomic user update). */
export async function updatePersonDepartmentDomain(
  actor: Actor,
  userId: string,
  department: string,
  deps: PeoplePorts
): Promise<PeopleDomainResult<Record<string, never>>> {
  if (!isAdminActor(actor)) {
    return fail('FORBIDDEN', 'You do not have permission to perform this action.')
  }
  if (!userId) return fail('VALIDATION_ERROR', 'User ID is required.')

  const cleanDepartment = department.trim()
  const result = await deps.persistence.updateUser(actor, userId, {
    department: cleanDepartment || null,
  })
  if (result.error) return fail('STORAGE_ERROR', result.error)

  await safeAudit(deps, actor, {
    action: 'user.department_change',
    targetId: userId,
    detail: { department: cleanDepartment || null },
  })
  return succeed({})
}

/**
 * Admin: set who a user reports to (manager or team lead). Guards against
 * self-assignment and reporting cycles before persisting.
 */
export async function setPersonManagerDomain(
  actor: Actor,
  userId: string,
  managerId: string | null,
  deps: PeoplePorts
): Promise<PeopleDomainResult<Record<string, never>>> {
  if (!isAdminActor(actor)) {
    return fail('FORBIDDEN', 'You do not have permission to perform this action.')
  }
  if (userId === actor.id) {
    return fail('VALIDATION_ERROR', 'You cannot change your own reporting line.')
  }
  if (managerId === userId) {
    return fail('VALIDATION_ERROR', 'A user cannot report to themselves.')
  }

  if (managerId) {
    // Cycle guard: walk the manager chain upward from the proposed manager; if
    // it ever reaches `userId`, assigning would create a loop.
    const users = await deps.persistence.listProfiles(actor)
    const byId = new Map(users.map((u) => [u.id, u]))
    let current: User | undefined = byId.get(managerId)
    const seen = new Set<string>()
    while (current && current.manager_id && !seen.has(current.id)) {
      if (current.manager_id === userId) {
        return fail('VALIDATION_ERROR', 'That assignment would create a reporting cycle.')
      }
      seen.add(current.id)
      current = byId.get(current.manager_id)
    }
  }

  const result = await deps.persistence.updateUserManager(actor, userId, managerId)
  if (result.error) return fail('STORAGE_ERROR', result.error)

  await safeAudit(deps, actor, {
    action: 'user.manager_change',
    targetId: userId,
    detail: { managerId },
  })
  return succeed({})
}

/** A user edits their own department/title. Titles may not cross hierarchy roles. */
export async function updateOwnProfileDomain(
  actor: Actor,
  input: { department: string; title: string },
  deps: PeoplePorts
): Promise<PeopleDomainResult<Record<string, never>>> {
  const cleanTitle = input.title.trim()
  if (cleanTitle) {
    const titles = await loadTitles(deps, 'Failed to load title records for profile update', {})
    const targetClassification = roleForTitle(cleanTitle, titles)
    if (targetClassification !== actor.hierarchy_role) {
      return fail(
        'VALIDATION_ERROR',
        `Cannot change to title "${cleanTitle}" because it belongs to the "${targetClassification}" hierarchy role. Changing hierarchy roles requires an administrator.`
      )
    }
  }

  const result = await deps.persistence.updateMyProfile(actor, {
    department: input.department.trim(),
    title: cleanTitle,
  })
  if (result.error) return fail('STORAGE_ERROR', result.error)
  return succeed({})
}

/**
 * Admin hierarchy edit. Resolves the hierarchy role from the title when it is
 * omitted, rejects a contradictory title+hierarchy pair, blocks self role/report
 * changes, and guards the reporting line against cycles. The permission axis is
 * never touched.
 */
export async function updatePersonHierarchyDomain(
  actor: Actor,
  userId: string,
  data: { managerId: string | null; title?: string; hierarchyRole?: HierarchyRole },
  deps: PeoplePorts
): Promise<PeopleDomainResult<Record<string, never>>> {
  if (!isAdminActor(actor)) {
    return fail('FORBIDDEN', 'You do not have permission to perform this action.')
  }
  if (!userId) return fail('VALIDATION_ERROR', 'User ID is required.')
  if (data.hierarchyRole !== undefined && !isOneOf(data.hierarchyRole, HIERARCHY_ROLES)) {
    return fail('VALIDATION_ERROR', 'Invalid hierarchy role.')
  }

  const targetUser = await deps.persistence.getProfileById(userId)
  if (!targetUser) return fail('NOT_FOUND', 'User not found.')

  const allTitles = await loadTitles(deps, 'Failed to load title records for user hierarchy update', {
    userId,
  })

  // If the title is updated and no hierarchy role is explicitly provided,
  // auto-sync it from the title. The permission axis is untouched.
  let targetHierarchyRole = data.hierarchyRole
  if (data.title && !targetHierarchyRole) {
    targetHierarchyRole = roleForTitle(data.title, allTitles)
  }

  // Reject a contradictory title+hierarchy-role save (e.g. title "Manager"
  // with hierarchy role "user").
  const effectiveTitle = data.title !== undefined ? data.title : targetUser.title
  if (
    data.hierarchyRole !== undefined &&
    effectiveTitle &&
    roleForTitle(effectiveTitle, allTitles) !== data.hierarchyRole
  ) {
    return fail(
      'VALIDATION_ERROR',
      `Hierarchy role "${data.hierarchyRole}" is inconsistent with the title "${effectiveTitle}".`
    )
  }

  const selfEdit = userId === actor.id
  if (selfEdit) {
    if (targetHierarchyRole && targetHierarchyRole !== targetUser.hierarchy_role) {
      return fail('VALIDATION_ERROR', 'You cannot change your own role.')
    }
    if (data.managerId !== undefined && data.managerId !== targetUser.manager_id) {
      return fail('VALIDATION_ERROR', 'You cannot change your own reporting line.')
    }
  }

  if (data.managerId) {
    const allUsers = await deps.persistence.listProfiles(actor)
    if (wouldCreateHierarchyCycle(allUsers, userId, data.managerId)) {
      return fail(
        'VALIDATION_ERROR',
        'Invalid reporting line: assigning this manager creates a circular reporting loop.'
      )
    }
  }

  const result = await deps.persistence.updateUserHierarchy(actor, userId, {
    managerId: data.managerId,
    title: data.title,
    hierarchyRole: targetHierarchyRole,
  })
  if (result.error) return fail('STORAGE_ERROR', result.error)

  await safeAudit(deps, actor, {
    action: 'user.hierarchy_update',
    targetId: userId,
    detail: { managerId: data.managerId, title: data.title, hierarchyRole: targetHierarchyRole },
  })
  return succeed({})
}

// --- atomic account update (mobile /api/v1/admin/users/[id]) ----------------

/**
 * Presence-aware patch for the atomic admin update. `undefined` means "not
 * supplied" (leave unchanged); `null` clears a nullable field.
 */
export interface UpdatePersonPatch {
  name?: string
  department?: string | null
  title?: string | null
  permissionRole?: PermissionRole
  hierarchyRole?: HierarchyRole
  managerId?: string | null
  isActive?: boolean
}

/**
 * Admin: atomic complete update of a user profile. Validates the whole payload
 * before the single persistence write, then records the established audit
 * entries. Returns the re-read profile so transports can echo the new state.
 */
export async function updatePersonDomain(
  actor: Actor,
  targetId: string,
  patch: UpdatePersonPatch,
  deps: PeoplePorts
): Promise<PeopleDomainResult<User | null>> {
  if (!isAdminActor(actor)) {
    return fail('FORBIDDEN', 'You do not have permission to perform this action.')
  }
  if (!targetId) return fail('VALIDATION_ERROR', 'User ID is required.')

  const targetUser = await deps.persistence.getProfileById(targetId)
  if (!targetUser) return fail('NOT_FOUND', 'User not found.')

  const isSelf = targetId === actor.id

  // 1. Name validation
  if (patch.name !== undefined && !isNonEmpty(patch.name)) {
    return fail('VALIDATION_ERROR', 'Name is required.')
  }

  // 2. Status validation (self-deactivation guard)
  if (patch.isActive !== undefined && isSelf && !patch.isActive) {
    return fail('VALIDATION_ERROR', 'You cannot deactivate your own account.')
  }

  // 3. Role validations (self-role guard)
  if (patch.permissionRole !== undefined) {
    if (!isOneOf(patch.permissionRole, PERMISSION_ROLES)) {
      return fail('VALIDATION_ERROR', 'Invalid permission role.')
    }
    if (isSelf && patch.permissionRole !== targetUser.permission_role) {
      return fail('VALIDATION_ERROR', 'You cannot change your own roles.')
    }
  }
  if (patch.hierarchyRole !== undefined) {
    if (!isOneOf(patch.hierarchyRole, HIERARCHY_ROLES)) {
      return fail('VALIDATION_ERROR', 'Invalid hierarchy role.')
    }
    if (isSelf && patch.hierarchyRole !== targetUser.hierarchy_role) {
      return fail('VALIDATION_ERROR', 'You cannot change your own roles.')
    }
  }

  // 4. Title & hierarchy-role consistency
  const allTitles = await loadTitles(deps, 'Failed to load title records for user update', {
    targetId,
  })
  const effectiveTitle = patch.title !== undefined ? patch.title || '' : targetUser.title || ''
  let effectiveHierRole: HierarchyRole | undefined =
    patch.hierarchyRole !== undefined ? patch.hierarchyRole : targetUser.hierarchy_role
  let hierarchyRoleToUpdate = patch.hierarchyRole

  // If the title was updated but hierarchyRole was omitted, auto-derive it.
  if (patch.title !== undefined && patch.hierarchyRole === undefined && patch.title) {
    effectiveHierRole = roleForTitle(patch.title, allTitles)
    hierarchyRoleToUpdate = effectiveHierRole
  }

  if (effectiveTitle && effectiveHierRole && roleForTitle(effectiveTitle, allTitles) !== effectiveHierRole) {
    return fail(
      'VALIDATION_ERROR',
      `Hierarchy role "${effectiveHierRole}" is inconsistent with the title "${effectiveTitle}".`
    )
  }

  // 5. Manager validation & loop prevention
  if (patch.managerId !== undefined) {
    if (isSelf && patch.managerId !== targetUser.manager_id) {
      return fail('VALIDATION_ERROR', 'You cannot change your own reporting line.')
    }
    if (patch.managerId === targetId) {
      return fail('VALIDATION_ERROR', 'A user cannot report to themselves.')
    }
    if (patch.managerId) {
      const manager = await deps.persistence.getProfileById(patch.managerId)
      if (!manager || !manager.is_active) {
        return fail('VALIDATION_ERROR', 'Selected manager does not exist or is inactive.')
      }
      if (manager.hierarchy_role !== 'manager' && manager.hierarchy_role !== 'team_lead') {
        return fail(
          'VALIDATION_ERROR',
          'Selected manager must have a leadership hierarchy role (manager or team lead).'
        )
      }
      const allUsers = await deps.persistence.listProfiles(actor)
      if (wouldCreateHierarchyCycle(allUsers, targetId, patch.managerId)) {
        return fail(
          'VALIDATION_ERROR',
          'Invalid reporting line: assigning this manager creates a circular reporting loop.'
        )
      }
    }
  }

  // 6. Atomic persistence write
  const updateInput: UpdateUserInput = {
    name: patch.name,
    department: patch.department,
    title: patch.title,
    permissionRole: patch.permissionRole,
    hierarchyRole: hierarchyRoleToUpdate,
    managerId: patch.managerId,
    isActive: patch.isActive,
  }
  const writeResult = await deps.persistence.updateUser(actor, targetId, updateInput)
  if (writeResult.error) return fail('STORAGE_ERROR', writeResult.error)

  // 7. Audit logging (each entry best-effort, with the transport's warning)
  if (patch.isActive !== undefined && patch.isActive !== targetUser.is_active) {
    await auditOrWarn(
      deps,
      actor,
      { action: 'user.status_change', targetId, detail: { isActive: patch.isActive } },
      'Failed to write audit log for user status change',
      targetId
    )
  }
  if (
    (patch.permissionRole !== undefined && patch.permissionRole !== targetUser.permission_role) ||
    (hierarchyRoleToUpdate !== undefined && hierarchyRoleToUpdate !== targetUser.hierarchy_role)
  ) {
    await auditOrWarn(
      deps,
      actor,
      {
        action: 'user.role_change',
        targetId,
        detail: {
          permissionRole: patch.permissionRole ?? targetUser.permission_role,
          hierarchyRole: hierarchyRoleToUpdate ?? targetUser.hierarchy_role,
        },
      },
      'Failed to write audit log for user role change',
      targetId
    )
  }
  if (
    (patch.managerId !== undefined && patch.managerId !== targetUser.manager_id) ||
    (patch.title !== undefined && patch.title !== targetUser.title)
  ) {
    await auditOrWarn(
      deps,
      actor,
      {
        action: 'user.hierarchy_update',
        targetId,
        detail: {
          managerId: patch.managerId !== undefined ? patch.managerId : targetUser.manager_id,
          title: patch.title !== undefined ? patch.title : targetUser.title,
          hierarchyRole: effectiveHierRole,
        },
      },
      'Failed to write audit log for user hierarchy update',
      targetId
    )
  }

  const updated = await deps.persistence.getProfileById(targetId)
  return succeed(updated)
}
