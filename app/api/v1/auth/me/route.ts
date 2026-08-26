import { requireMobileActor, json, serverError } from '@/app/api/v1/_http'

import { withRequestLogging } from '../../_observability'
export const runtime = 'nodejs'

export const GET = withRequestLogging('GET /api/v1/auth/me', async (request: Request) => {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response
    return json({
      data: {
        id: auth.actor.id,
        email: auth.actor.email,
        role: auth.actor.role,
        permissionRole: auth.actor.permission_role,
        hierarchyRole: auth.actor.hierarchy_role,
        isActive: auth.actor.isActive,
      },
      error: null,
    })
  } catch (err) {
    return serverError(err)
  }
})
