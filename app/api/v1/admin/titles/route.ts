import { withMobileActor, apiError, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import {
  addTitleAdmin,
  deleteTitleAdmin,
  listTitleRecordsAdmin,
  reclassifyTitleAdmin,
} from '@/lib/api/v1/services/reference-admin'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import type { HierarchyRole } from '@/app/types'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      return serviceResultResponse(await listTitleRecordsAdmin(auth.actor))
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
      const name = typeof body.name === 'string' ? body.name : ''
      const hierarchyRole = (body.hierarchyRole || 'user') as HierarchyRole

      return serviceResultResponse(await addTitleAdmin(auth.actor, name, hierarchyRole), 201)
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function PATCH(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      if (!isSuperAdmin(auth.actor)) {
        return apiError(
          'FORBIDDEN',
          'Super-admin access required to reclassify title definitions.',
          403
        )
      }

      const body = await request.json().catch(() => ({}))
      const name = typeof body.name === 'string' ? body.name : ''
      const hierarchyRole = body.hierarchyRole as HierarchyRole
      const syncUsers = Boolean(body.syncUsers)

      return serviceResultResponse(
        await reclassifyTitleAdmin(auth.actor, name, hierarchyRole, syncUsers)
      )
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

      return serviceResultResponse(await deleteTitleAdmin(auth.actor, name ?? ''))
    } catch (err) {
      return serverError(err)
    }
  })
}
