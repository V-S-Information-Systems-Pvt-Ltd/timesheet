import { withMobileActor, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { deleteActivityTypeAdmin, updateActivityTypeAdmin } from '@/lib/api/v1/services/reference-admin'
import type { UpdateActivityTypePatch } from '@/lib/domain/reference'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id: actTypeId } = await params
      const body = await request.json().catch(() => ({}))

      const patch: UpdateActivityTypePatch = {}
      if ('name' in body) patch.name = typeof body.name === 'string' ? body.name : ''
      if ('isActive' in body) patch.isActive = Boolean(body.isActive)
      if ('telegramNo' in body) {
        patch.telegramNo = typeof body.telegramNo === 'number' ? body.telegramNo : null
      }

      return serviceResultResponse(await updateActivityTypeAdmin(auth.actor, actTypeId, patch))
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id: actTypeId } = await params
      return serviceResultResponse(await deleteActivityTypeAdmin(auth.actor, actTypeId))
    } catch (err) {
      return serverError(err)
    }
  })
}
