import { withMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { isNonEmpty } from '@/lib/validation'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      if (auth.actor.permission_role !== 'admin') {
        return apiError('FORBIDDEN', 'Only admins can view activity type administration.', 403)
      }

      const data = await repo.listActivityTypes(auth.actor)
      return json({ data, error: null })
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      if (auth.actor.permission_role !== 'admin') {
        return apiError('FORBIDDEN', 'Only admins can create activity types.', 403)
      }

      const body = await request.json().catch(() => ({}))
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const telegramNo = typeof body.telegramNo === 'number' ? body.telegramNo : null

      if (!isNonEmpty(name)) {
        return badRequest('Activity type name is required.')
      }

      if (telegramNo !== null && (!Number.isInteger(telegramNo) || telegramNo <= 0)) {
        return badRequest('Bot number must be a positive whole number.')
      }

      const createRes = await repo.createActivityType(auth.actor, name, { telegramNo })
      if (createRes.error || !createRes.data) {
        return apiError('CONFLICT', createRes.error ?? 'Failed to create activity type.', 409)
      }

      return json({ data: createRes.data, error: null }, 201)
    } catch (err) {
      return serverError(err)
    }
  })
}
