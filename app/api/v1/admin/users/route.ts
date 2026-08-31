import { requireMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { isNonEmpty, isOneOf, isValidEmail } from '@/lib/validation'
import { passwordSchema } from '@/lib/validation-schemas'
import { HIERARCHY_ROLES, PERMISSION_ROLES } from '@/lib/roles'
import { roleForTitle } from '@/app/constants'
import type { HierarchyRole, PermissionRole } from '@/app/types'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin') {
      return apiError('FORBIDDEN', 'Only administrators can view user administration.', 403)
    }

    const profiles = await repo.listProfiles(auth.actor)
    return json({ data: profiles, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin') {
      return apiError('FORBIDDEN', 'Only administrators can create users.', 403)
    }

    const body = await request.json().catch(() => ({}))
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const department = typeof body.department === 'string' ? body.department.trim() : ''
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const permissionRole = (body.permissionRole || 'user') as PermissionRole
    let hierarchyRole = (body.hierarchyRole || 'user') as HierarchyRole
    const isActive = body.isActive !== false
    const managerId = typeof body.managerId === 'string' ? body.managerId.trim() || null : null

    if (!isNonEmpty(email) || !isNonEmpty(password)) {
      return badRequest('Email and password are required.')
    }
    if (!isValidEmail(email)) {
      return badRequest('Please enter a valid email address.')
    }

    const pwdCheck = passwordSchema.safeParse(password)
    if (!pwdCheck.success) {
      return badRequest(pwdCheck.error.issues[0]?.message ?? 'Password does not meet complexity requirements.')
    }

    if (!isOneOf(permissionRole, PERMISSION_ROLES)) {
      return badRequest('Invalid permission role.')
    }
    if (!isOneOf(hierarchyRole, HIERARCHY_ROLES)) {
      return badRequest('Invalid hierarchy role.')
    }

    if (title) {
      const titles = await repo.listTitleRecords().catch(() => [])
      const titleClassification = roleForTitle(title, titles)
      if (body.hierarchyRole && hierarchyRole !== titleClassification) {
        return badRequest(`Hierarchy role "${hierarchyRole}" is inconsistent with the title "${title}".`)
      }
      hierarchyRole = titleClassification
    }

    const res = await repo.createUser(auth.actor, {
      email,
      password,
      name,
      department,
      title,
      permissionRole,
      hierarchyRole,
      isActive,
      managerId,
    })

    if (res.error) {
      return apiError('CONFLICT', res.error, 409)
    }

    const all = await repo.listProfiles(auth.actor)
    const created = all.find((p) => p.email === email)
    return json({ data: created, error: null }, { status: 201 })
  } catch (err) {
    return serverError(err)
  }
}
