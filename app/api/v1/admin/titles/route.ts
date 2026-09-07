import { withMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import { isNonEmpty, isOneOf } from '@/lib/validation'
import { HIERARCHY_ROLES } from '@/lib/roles'
import type { HierarchyRole } from '@/app/types'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async () => {
    try {
      const titles = await repo.listTitleRecords()
      return json({ data: titles, error: null })
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
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

      // The adapter returns the inserted row atomically (RETURNING /
      // insert-select). No list/find fallback: a follow-up read could observe
      // an intervening rename/delete and return the wrong row.
      const created = ('data' in res && res.data) ? res.data : null
      if (!created) {
        return serverError(new Error('Title created but no row was returned.'))
      }

      return json({ data: created, error: null }, 201)
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function PATCH(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
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
  })
}

export async function DELETE(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
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
  })
}
