import { requireMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { isNonEmpty, isOneOf } from '@/lib/validation'
import { HIERARCHY_ROLES, PERMISSION_ROLES } from '@/lib/roles'
import { wouldCreateHierarchyCycle } from '@/lib/hierarchy'
import { roleForTitle } from '@/app/constants'
import type { HierarchyRole, PermissionRole } from '@/app/types'

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

    // 1. Status update
    if ('isActive' in body) {
      const isActive = Boolean(body.isActive)
      if (isSelf && !isActive) {
        return badRequest('You cannot deactivate your own account.')
      }
      const res = await repo.updateUserStatus(auth.actor, targetId, isActive)
      if (res.error) return apiError('BAD_REQUEST', res.error, 400)
    }

    // 2. Name update
    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!isNonEmpty(name)) return badRequest('Name is required.')
      const res = await repo.updateUserName(auth.actor, targetId, name)
      if (res.error) return apiError('BAD_REQUEST', res.error, 400)
    }

    // 3. Permission and Hierarchy Role updates
    const hasPermRole = 'permissionRole' in body
    const hasHierRole = 'hierarchyRole' in body
    const hasTitle = 'title' in body
    const hasManager = 'managerId' in body

    if (hasPermRole || hasHierRole) {
      if (isSelf) {
        return badRequest('You cannot change your own roles.')
      }
      const permRole = (body.permissionRole || targetUser.permission_role) as PermissionRole
      const hierRole = (body.hierarchyRole || targetUser.hierarchy_role) as HierarchyRole

      if (!isOneOf(permRole, PERMISSION_ROLES)) return badRequest('Invalid permission role.')
      if (!isOneOf(hierRole, HIERARCHY_ROLES)) return badRequest('Invalid hierarchy role.')

      const res = await repo.updateUserRoles(auth.actor, targetId, permRole, hierRole)
      if (res.error) return apiError('BAD_REQUEST', res.error, 400)
    }

    // 4. Hierarchy details (manager, title)
    if (hasManager || hasTitle || hasHierRole) {
      const managerId = hasManager ? (body.managerId ? String(body.managerId).trim() : null) : targetUser.manager_id
      const title = hasTitle ? (typeof body.title === 'string' ? body.title.trim() : '') : targetUser.title

      if (hasManager && isSelf && managerId !== targetUser.manager_id) {
        return badRequest('You cannot change your own reporting line.')
      }
      if (hasManager && managerId === targetId) {
        return badRequest('A user cannot report to themselves.')
      }

      const allTitles = await repo.listTitleRecords().catch(() => [])
      let hierRole = (body.hierarchyRole || targetUser.hierarchy_role) as HierarchyRole
      if (title && !body.hierarchyRole) {
        hierRole = roleForTitle(title, allTitles)
      }

      if (title && hierRole && roleForTitle(title, allTitles) !== hierRole) {
        return badRequest(`Hierarchy role "${hierRole}" is inconsistent with the title "${title}".`)
      }

      if (managerId) {
        const allUsers = await repo.listProfiles(auth.actor)
        if (wouldCreateHierarchyCycle(allUsers, targetId, managerId)) {
          return badRequest('Invalid reporting line: assigning this manager creates a circular reporting loop.')
        }
      }

      const res = await repo.updateUserHierarchy(auth.actor, targetId, {
        managerId,
        title,
        hierarchyRole: hierRole,
      })
      if (res.error) return apiError('BAD_REQUEST', res.error, 400)
    }

    // 5. Department update
    if ('department' in body) {
      const department = typeof body.department === 'string' ? body.department.trim() : ''
      // If repo has updateUserDepartment or updateUserProfile
      const current = await repo.getProfileById(targetId)
      if (current) {
        await repo.updateUserHierarchy(auth.actor, targetId, {
          managerId: current.manager_id,
          title: current.title || '',
          hierarchyRole: current.hierarchy_role,
        })
      }
    }

    const updated = await repo.getProfileById(targetId)
    return json({ data: updated, error: null })
  } catch (err) {
    return serverError(err)
  }
}
