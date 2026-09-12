import { withMobileActor, serverError, parseJsonBody, serviceResultResponse } from '@/app/api/v1/_http'
import { updateReminderService, deleteReminderService } from '@/lib/api/v1/services/reminders'
import { withIdempotency } from '@/lib/idempotency'

export const runtime = 'nodejs'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params

      const parsedBody = await parseJsonBody(request)
      if (!parsedBody.ok) return parsedBody.response
      const body = parsedBody.body

      return await withIdempotency(request, auth.actor.id, 'update_reminder', { id, body }, async () => {
        const result = await updateReminderService(auth.actor, id, body)
        return serviceResultResponse(result)
      })
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params

      return await withIdempotency(request, auth.actor.id, 'delete_reminder', { id }, async () => {
        const result = await deleteReminderService(auth.actor, id)
        return serviceResultResponse(result)
      })
    } catch (err) {
      return serverError(err)
    }
  })
}
