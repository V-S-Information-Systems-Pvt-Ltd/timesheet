import { requireMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import { isNonEmpty, isOneOf } from '@/lib/validation'
import { HIERARCHY_ROLES } from '@/lib/roles'
import type { HierarchyRole } from '@/app/types'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const titles = await repo.listTitleRecords()
    return json({ data: titles, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (!isSuperAdmin(auth.actor)) {
      return apiError('FORBIDDEN', 'Super-admin access required to create title definitions.', 403)
    }

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const hierarchyRole = (body.hierarchyRole || 'user') as HierarchyRole

    if (!isNonEmpty(name)) {
      return badRequest('Title name is required.')
    }
    if (!isOneOf(hierarchyRole, HIERARCHY_ROLES)) {
      return badRequest('Invalid hierarchy role.')
    }

    const res = await repo.addTitle(auth.actor, name, hierarchyRole)
    if (res.error) {
      return apiError('CONFLICT', res.error, 409)
    }

    const titles = await repo.listTitleRecords()
    const created = titles.find((t) => t.name === name)
    return json({ data: created, error: null }, 201)
  } catch (err) {
    return serverError(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (!isSuperAdmin(auth.actor)) {
      return apiError('FORBIDDEN', 'Super-admin access required to reclassify title definitions.', 403)
    }

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const hierarchyRole = body.hierarchyRole as HierarchyRole
    const syncUsers = Boolean(body.syncUsers)

    if (!isNonEmpty(name)) {
      return badRequest('Title name is required.')
    }
    if (!isOneOf(hierarchyRole, HIERARCHY_ROLES)) {
      return badRequest('Invalid hierarchy role.')
    }

    const res = await repo.reclassifyTitle(auth.actor, name, hierarchyRole, syncUsers)
    if (res.error) {
      return apiError('BAD_REQUEST', res.error, 400)
    }

    return json({ data: { name, hierarchyRole, affectedCount: res.affectedCount }, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (!isSuperAdmin(auth.actor)) {
      return apiError('FORBIDDEN', 'Super-admin access required to delete title definitions.', 403)
    }

    const url = new URL(request.url)
    let name = url.searchParams.get('name')
    if (!name) {
      const body = await request.json().catch(() => ({}))
      name = typeof body.name === 'string' ? body.name : null
    }

    if (!name || !isNonEmpty(name)) {
      return badRequest('Title name is required.')
    }

    const res = await repo.deleteTitle(auth.actor, name.trim())
    if (res.error) {
      return apiError('CONFLICT', res.error, 409)
    }

    return json({ data: { success: true, name }, error: null })
  } catch (err) {
    return serverError(err)
  }
}
