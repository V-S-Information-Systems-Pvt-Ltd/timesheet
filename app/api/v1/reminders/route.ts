import { withMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { listRemindersService, createReminderService } from '@/lib/api/v1/services/reminders'
import { withIdempotency } from '@/lib/idempotency'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const result = await listRemindersService(auth.actor)
      if (!result.success) {
        return apiError(result.code, result.message, result.status)
      }

      return json({ data: result.data, error: null })
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400)
      }

      return await withIdempotency(request, auth.actor.id, 'create_reminder', body, async () => {
        const result = await createReminderService(auth.actor, body)
        if (!result.success) {
          return apiError(result.code, result.message, result.status)
        }
        return json({ data: result.data, error: null }, result.status ?? 201)
      })
    } catch (err) {
      return serverError(err)
    }
  })
}
