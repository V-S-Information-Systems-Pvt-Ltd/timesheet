import { withMobileActor, apiError, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import {
  addTitleAdmin,
  deleteTitleAdmin,
  listTitleRecordsAdmin,
  reclassifyTitleAdmin,
} from '@/lib/api/v1/services/reference-admin'
import {
  addTitleBrowser,
  deleteTitleBrowser,
  reclassifyTitleBrowser,
} from '@/lib/api/v1/services/superadmin'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import type { HierarchyRole } from '@/app/types'
import { browserTitleCreateSchema, browserTitleReclassifySchema } from '@vsis/contracts'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      return serviceResultResponse(await listTitleRecordsAdmin(auth.actor))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      if (!isSuperAdmin(auth.actor)) {
        return apiError('FORBIDDEN', 'Super-admin access required to create title definitions.', 403)
      }

      const body = await request.json().catch(() => null)
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return apiError('VALIDATION_ERROR', 'A title is required.', 400)
      }
      if (auth.via === 'cookie') {
        const parsed = browserTitleCreateSchema.safeParse(body)
        if (!parsed.success) {
          return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'A title is required.', 400)
        }
        return serviceResultResponse(
          await addTitleBrowser(auth.actor, parsed.data.name, parsed.data.hierarchyRole),
          201
        )
      }
      const name = typeof body.name === 'string' ? body.name : ''
      const hierarchyRole = (body.hierarchyRole || 'user') as HierarchyRole

      return serviceResultResponse(await addTitleAdmin(auth.actor, name, hierarchyRole), 201)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
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

      const body = await request.json().catch(() => null)
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return apiError('VALIDATION_ERROR', 'A title mutation is required.', 400)
      }
      if (auth.via === 'cookie') {
        const parsed = browserTitleReclassifySchema.safeParse(body)
        if (!parsed.success) {
          return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'A title mutation is required.', 400)
        }
        return serviceResultResponse(await reclassifyTitleBrowser(
          auth.actor,
          parsed.data.name,
          parsed.data.hierarchyRole,
          parsed.data.syncUsers
        ))
      }
      const name = typeof body.name === 'string' ? body.name : ''
      const hierarchyRole = body.hierarchyRole as HierarchyRole
      if ('syncUsers' in body && typeof body.syncUsers !== 'boolean') {
        return apiError('VALIDATION_ERROR', 'syncUsers must be a boolean.', 400)
      }
      const syncUsers = body.syncUsers ?? false

      return serviceResultResponse(
        await reclassifyTitleAdmin(auth.actor, name, hierarchyRole, syncUsers)
      )
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
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

      return serviceResultResponse(
        auth.via === 'cookie'
          ? await deleteTitleBrowser(auth.actor, name ?? '')
          : await deleteTitleAdmin(auth.actor, name ?? '')
      )
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
