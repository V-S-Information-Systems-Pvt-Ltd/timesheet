import { withMobileActor, serverError, parseJsonBody, serviceResultResponse } from '@/app/api/v1/_http'
import { listRemindersService, createReminderService } from '@/lib/api/v1/services/reminders'
import { withIdempotency } from '@/lib/idempotency'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const result = await listRemindersService(auth.actor)
      return serviceResultResponse(result)
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const parsedBody = await parseJsonBody(request)
      if (!parsedBody.ok) return parsedBody.response
      const body = parsedBody.body

      return await withIdempotency(request, auth.actor.id, 'create_reminder', body, async () => {
        const result = await createReminderService(auth.actor, body)
        return serviceResultResponse(result, 201)
      }, { successStatus: 201 })
    } catch (err) {
      return serverError(err)
    }
  })
}
