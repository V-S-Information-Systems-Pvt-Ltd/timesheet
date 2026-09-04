import { requireMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { isNonEmpty, isOneOf } from '@/lib/validation'
import { HIERARCHY_ROLES, PERMISSION_ROLES } from '@/lib/roles'
import { wouldCreateHierarchyCycle } from '@/lib/hierarchy'
import { roleForTitle } from '@/app/constants'
import type { HierarchyRole, PermissionRole } from '@/app/types'
import { logger, extractError } from '@/lib/logger'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin') {
      return apiError('FORBIDDEN', 'Only administrators can update users.', 403)
    }

    const { id: targetId } = await params
    if (!targetId) return badRequest('User ID is required.')

    const targetUser = await repo.getProfileById(targetId)
    if (!targetUser) return apiError('NOT_FOUND', 'User not found.', 404)

    const body = await request.json().catch(() => ({}))
    const isSelf = targetId === auth.actor.id

    // 1. Name validation
    let nameToUpdate: string | undefined = undefined
    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!isNonEmpty(name)) return badRequest('Name is required.')
      nameToUpdate = name
    }

    // 2. Department validation
    let departmentToUpdate: string | null | undefined = undefined
    if ('department' in body) {
      departmentToUpdate = typeof body.department === 'string' ? (body.department.trim() || null) : null
    }

    // 3. Status validation (self-deactivation guard)
    let isActiveToUpdate: boolean | undefined = undefined
    if ('isActive' in body) {
      const isActive = Boolean(body.isActive)
      if (isSelf && !isActive) {
        return badRequest('You cannot deactivate your own account.')
      }
      isActiveToUpdate = isActive
    }

    // 4. Role validations (self-role guard)
    let permRoleToUpdate: PermissionRole | undefined = undefined
    if ('permissionRole' in body) {
      const permRole = body.permissionRole as PermissionRole
      if (!isOneOf(permRole, PERMISSION_ROLES)) return badRequest('Invalid permission role.')
      if (isSelf && permRole !== targetUser.permission_role) {
        return badRequest('You cannot change your own roles.')
      }
      permRoleToUpdate = permRole
    }

    let hierRoleToUpdate: HierarchyRole | undefined = undefined
    if ('hierarchyRole' in body) {
      const hierRole = body.hierarchyRole as HierarchyRole
      if (!isOneOf(hierRole, HIERARCHY_ROLES)) return badRequest('Invalid hierarchy role.')
      if (isSelf && hierRole !== targetUser.hierarchy_role) {
        return badRequest('You cannot change your own roles.')
      }
      hierRoleToUpdate = hierRole
    }

    // 5. Title & Hierarchy consistency validation
    let titleToUpdate: string | null | undefined = undefined
    if ('title' in body) {
      titleToUpdate = typeof body.title === 'string' ? (body.title.trim() || null) : null
    }

    const allTitles = await repo.listTitleRecords().catch((err) => {
      logger.warn('Failed to load title records for user update', { error: extractError(err), targetId })
      return []
    })
    const effectiveTitle = titleToUpdate !== undefined ? (titleToUpdate || '') : (targetUser.title || '')
    let effectiveHierRole = hierRoleToUpdate !== undefined ? hierRoleToUpdate : targetUser.hierarchy_role

    // If title was updated but hierarchyRole was omitted, auto-derive hierarchyRole from title
    if (titleToUpdate !== undefined && hierRoleToUpdate === undefined && titleToUpdate) {
      effectiveHierRole = roleForTitle(titleToUpdate, allTitles)
      hierRoleToUpdate = effectiveHierRole
    }

    if (effectiveTitle && effectiveHierRole && roleForTitle(effectiveTitle, allTitles) !== effectiveHierRole) {
      return badRequest(`Hierarchy role "${effectiveHierRole}" is inconsistent with the title "${effectiveTitle}".`)
    }

    // 6. Manager validation & loop prevention
    let managerIdToUpdate: string | null | undefined = undefined
    if ('managerId' in body) {
      const managerId = typeof body.managerId === 'string' ? (body.managerId.trim() || null) : null
      if (isSelf && managerId !== targetUser.manager_id) {
        return badRequest('You cannot change your own reporting line.')
      }
      if (managerId === targetId) {
        return badRequest('A user cannot report to themselves.')
      }
      if (managerId) {
        const manager = await repo.getProfileById(managerId)
        if (!manager || !manager.is_active) {
          return badRequest('Selected manager does not exist or is inactive.')
        }
        if (manager.hierarchy_role !== 'manager' && manager.hierarchy_role !== 'team_lead') {
          return badRequest('Selected manager must have a leadership hierarchy role (manager or team lead).')
        }
        const allUsers = await repo.listProfiles(auth.actor)
        if (wouldCreateHierarchyCycle(allUsers, targetId, managerId)) {
          return badRequest('Invalid reporting line: assigning this manager creates a circular reporting loop.')
        }
      }
      managerIdToUpdate = managerId
    }

    // 7. Atomic Repository Update
    const writeResult = await repo.updateUser(auth.actor, targetId, {
      name: nameToUpdate,
      department: departmentToUpdate,
      title: titleToUpdate,
      permissionRole: permRoleToUpdate,
      hierarchyRole: hierRoleToUpdate,
      managerId: managerIdToUpdate,
      isActive: isActiveToUpdate,
    })

    if (writeResult.error) {
      return apiError('BAD_REQUEST', writeResult.error, 400)
    }

    // 8. Audit Logging
    if (isActiveToUpdate !== undefined && isActiveToUpdate !== targetUser.is_active) {
      await repo.writeAuditLog(auth.actor, {
        action: 'user.status_change',
        targetId,
        detail: { isActive: isActiveToUpdate },
      }).catch((err) => {
        logger.warn('Failed to write audit log for user status change', { error: extractError(err), targetId })
      })
    }
    if (
      (permRoleToUpdate !== undefined && permRoleToUpdate !== targetUser.permission_role) ||
      (hierRoleToUpdate !== undefined && hierRoleToUpdate !== targetUser.hierarchy_role)
    ) {
      await repo.writeAuditLog(auth.actor, {
        action: 'user.role_change',
        targetId,
        detail: {
          permissionRole: permRoleToUpdate ?? targetUser.permission_role,
          hierarchyRole: hierRoleToUpdate ?? targetUser.hierarchy_role,
        },
      }).catch((err) => {
        logger.warn('Failed to write audit log for user role change', { error: extractError(err), targetId })
      })
    }
    if (
      (managerIdToUpdate !== undefined && managerIdToUpdate !== targetUser.manager_id) ||
      (titleToUpdate !== undefined && titleToUpdate !== targetUser.title)
    ) {
      await repo.writeAuditLog(auth.actor, {
        action: 'user.hierarchy_update',
        targetId,
        detail: {
          managerId: managerIdToUpdate !== undefined ? managerIdToUpdate : targetUser.manager_id,
          title: titleToUpdate !== undefined ? titleToUpdate : targetUser.title,
          hierarchyRole: effectiveHierRole,
        },
      }).catch((err) => {
        logger.warn('Failed to write audit log for user hierarchy update', { error: extractError(err), targetId })
      })
    }

    const updated = await repo.getProfileById(targetId)
    return json({ data: updated, error: null })
  } catch (err) {
    return serverError(err)
  }
}
