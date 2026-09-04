import { requireMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { isNonEmpty } from '@/lib/validation'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin') {
      return apiError('FORBIDDEN', 'Only admins can modify activity types.', 403)
    }

    const { id: actTypeId } = await params
    if (!actTypeId) return badRequest('Activity type ID is required.')

    const body = await request.json().catch(() => ({}))

    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!isNonEmpty(name)) return badRequest('Activity type name is required.')
      const res = await repo.renameActivityType(auth.actor, actTypeId, name)
      if (res.error) return apiError('CONFLICT', res.error, 409)
    }

    if ('isActive' in body) {
      const isActive = Boolean(body.isActive)
      const res = await repo.setActivityTypeActive(auth.actor, actTypeId, isActive)
      if (res.error) return apiError('BAD_REQUEST', res.error, 400)
    }

    if ('telegramNo' in body) {
      const telegramNo = typeof body.telegramNo === 'number' ? body.telegramNo : null
      if (telegramNo !== null && (!Number.isInteger(telegramNo) || telegramNo <= 0)) {
        return badRequest('Bot number must be a positive whole number.')
      }
      const res = await repo.setActivityTypeTelegramNo(auth.actor, actTypeId, telegramNo)
      if (res.error) return apiError('BAD_REQUEST', res.error, 400)
    }

    const all = await repo.listActivityTypes(auth.actor)
    const updated = all.find((a) => a.id === actTypeId)
    return json({ data: updated, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin') {
      return apiError('FORBIDDEN', 'Only admins can delete activity types.', 403)
    }

    const { id: actTypeId } = await params
    if (!actTypeId) return badRequest('Activity type ID is required.')

    const result = await repo.deleteActivityType(auth.actor, actTypeId)
    if (result.error) {
      return apiError('CONFLICT', result.error, 409)
    }

    return json({ data: { success: true, id: actTypeId }, error: null })
  } catch (err) {
    return serverError(err)
  }
}
