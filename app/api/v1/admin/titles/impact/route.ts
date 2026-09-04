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

    if (!isSuperAdmin(auth.actor)) {
      return apiError('FORBIDDEN', 'Super-admin access required to check title impact.', 403)
    }

    const url = new URL(request.url)
    const name = url.searchParams.get('name')?.trim() || ''
    const proposedRole = url.searchParams.get('proposedRole') as HierarchyRole | null

    if (!isNonEmpty(name)) {
      return badRequest('Title name parameter is required.')
    }
    if (proposedRole && !isOneOf(proposedRole, HIERARCHY_ROLES)) {
      return badRequest('Invalid proposed hierarchy role.')
    }

    const res = await repo.getTitleImpact(auth.actor, name, proposedRole ?? undefined)
    if ('error' in res) {
      return apiError('BAD_REQUEST', res.error, 400)
    }

    return json({ data: res, error: null })
  } catch (err) {
    return serverError(err)
  }
}
