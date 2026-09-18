import { withMobileActor, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { deleteProjectAdmin, updateProjectAdmin } from '@/lib/api/v1/services/reference-admin'
import type { UpdateProjectPatch } from '@/lib/domain/reference'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id: projectId } = await params
      const body = await request.json().catch(() => ({}))

      const patch: UpdateProjectPatch = {}
      if ('name' in body) patch.name = typeof body.name === 'string' ? body.name : ''
      if ('soNumber' in body) patch.soNumber = typeof body.soNumber === 'string' ? body.soNumber : null
      if ('telegramNo' in body) {
        patch.telegramNo = typeof body.telegramNo === 'number' ? body.telegramNo : null
      }

      return serviceResultResponse(await updateProjectAdmin(auth.actor, projectId, patch))
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id: projectId } = await params
      return serviceResultResponse(await deleteProjectAdmin(auth.actor, projectId))
    } catch (err) {
      return serverError(err)
    }
  })
}
