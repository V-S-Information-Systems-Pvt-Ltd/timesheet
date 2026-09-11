import { withMobileActor, serverError, apiError, parseJsonBody, serviceResultResponse } from '@/app/api/v1/_http'
import { getLeavesService, createLeavesService } from '@/lib/api/v1/services/leaves'
import { isAdminActor } from '@/lib/roles'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      if (!isAdminActor(auth.actor) && auth.actor.hierarchy_role !== 'manager' && auth.actor.hierarchy_role !== 'team_lead') {
        return apiError('FORBIDDEN', 'Only managers, leads, and administrators can manage team leaves.', 403)
      }

      const url = new URL(request.url)
      const raw: Record<string, unknown> = {}
      for (const key of ['userId', 'from', 'to'] as const) {
        const value = url.searchParams.get(key)
        if (value !== null && value !== '') raw[key] = value
      }

      const result = await getLeavesService(auth.actor, raw)
      return serviceResultResponse(result)
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      if (!isAdminActor(auth.actor) && auth.actor.hierarchy_role !== 'manager' && auth.actor.hierarchy_role !== 'team_lead') {
        return apiError('FORBIDDEN', 'Only managers, leads, and administrators can create leave markers.', 403)
      }

      const parsedBody = await parseJsonBody(request)
      if (!parsedBody.ok) return parsedBody.response
      const body = parsedBody.body

      const result = await createLeavesService(auth.actor, body)
      return serviceResultResponse(result, 201)
    } catch (err) {
      return serverError(err)
    }
  })
}
