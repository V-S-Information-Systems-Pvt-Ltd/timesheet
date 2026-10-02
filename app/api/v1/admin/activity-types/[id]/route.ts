import { apiError, withMobileActor, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { deleteActivityTypeAdmin, updateActivityTypeAdmin, updateActivityTypeBrowser } from '@/lib/api/v1/services/reference-admin'
import { deleteActivityTypeBrowser } from '@/lib/api/v1/services/superadmin'
import type { UpdateActivityTypePatch } from '@/lib/domain/reference'
import { browserActivityTypeMutationSchema } from '@vsis/contracts'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id: actTypeId } = await params
      const body = await request.json().catch(() => null)
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return apiError('VALIDATION_ERROR', 'An activity type mutation is required.', 400)
      }

      if (auth.via === 'cookie') {
        const parsed = browserActivityTypeMutationSchema.safeParse(body)
        if (!parsed.success) {
          return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'An activity type mutation is required.', 400)
        }
        return serviceResultResponse(await updateActivityTypeBrowser(auth.actor, actTypeId, parsed.data))
      }

      const patch: UpdateActivityTypePatch = {}
      if ('name' in body) {
        if (typeof body.name !== 'string') {
          return apiError('VALIDATION_ERROR', 'Activity type name must be a string.', 400)
        }
        patch.name = body.name
      }
      if ('isActive' in body) {
        if (typeof body.isActive !== 'boolean') {
          return apiError('VALIDATION_ERROR', 'Activity type active status must be a boolean.', 400)
        }
        patch.isActive = body.isActive
      }
      if ('telegramNo' in body) {
        if (
          body.telegramNo !== null &&
          (typeof body.telegramNo !== 'number' || !Number.isInteger(body.telegramNo) || body.telegramNo <= 0)
        ) {
          return apiError('VALIDATION_ERROR', 'Bot number must be a positive whole number.', 400)
        }
        patch.telegramNo = body.telegramNo
      }

      return serviceResultResponse(await updateActivityTypeAdmin(auth.actor, actTypeId, patch))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id: actTypeId } = await params
      return serviceResultResponse(
        auth.via === 'cookie'
          ? await deleteActivityTypeBrowser(auth.actor, actTypeId)
          : await deleteActivityTypeAdmin(auth.actor, actTypeId)
      )
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
