import { withMobileActor, apiSuccess, serverError, apiError, badRequest, parseJsonBody } from '@/app/api/v1/_http'
import { leaveReminderDeps } from '@/lib/db/leave-reminders'
import { updateGlobalReminder, deleteGlobalReminder } from '@/lib/domain/leave-reminders'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      if (auth.actor.permission_role !== 'admin') {
        return apiError('FORBIDDEN', 'Only administrators can edit global reminders.', 403)
      }

      const { id } = await params
      if (!id) return badRequest('Reminder ID is required.')

      const parsedBody = await parseJsonBody(request)
      if (!parsedBody.ok) return parsedBody.response
      const body = parsedBody.body

      const result = await updateGlobalReminder(auth.actor, id, body as Record<string, unknown>, leaveReminderDeps())
      if (!result.ok) {
        if (result.error.code === 'VALIDATION_ERROR') {
          return badRequest(result.error.message)
        }
        return apiError('BAD_REQUEST', result.error.message, 400)
      }

      return apiSuccess({ success: true, id })
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      if (auth.actor.permission_role !== 'admin') {
        return apiError('FORBIDDEN', 'Only administrators can delete global reminders.', 403)
      }

      const { id } = await params
      if (!id) return badRequest('Reminder ID is required.')

      const result = await deleteGlobalReminder(auth.actor, id, leaveReminderDeps())
      if (!result.ok) {
        return apiError('BAD_REQUEST', result.error.message, 400)
      }

      return apiSuccess({ success: true, id })
    } catch (err) {
      return serverError(err)
    }
  })
}
