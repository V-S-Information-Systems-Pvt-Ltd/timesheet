import { withMobileActor, serverError, apiError, badRequest, serviceResultResponse } from '@/app/api/v1/_http'
import { deleteLeaveService } from '@/lib/api/v1/services/leaves'
import { isAdminActor } from '@/lib/roles'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      if (!isAdminActor(auth.actor) && auth.actor.hierarchy_role !== 'manager' && auth.actor.hierarchy_role !== 'team_lead') {
        return apiError('FORBIDDEN', 'Only managers, leads, and administrators can delete leave markers.', 403)
      }

      const { id } = await params
      if (!id) return badRequest('Leave ID is required.')

      const result = await deleteLeaveService(auth.actor, id)
      return serviceResultResponse(result)
    } catch (err) {
      return serverError(err)
    }
  })
}
