import { withMobileActor, apiSuccess, apiError, serverError } from '@/app/api/v1/_http'
import { leaveReminderDeps } from '@/lib/db/leave-reminders'
import { dismissGlobalReminder } from '@/lib/domain/leave-reminders'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await props.params
      if (!id) {
        return apiError('INVALID_ID', 'Reminder ID is required', 400)
      }

      const result = await dismissGlobalReminder(auth.actor, id, leaveReminderDeps())
      if (!result.ok) {
        return apiError('DISMISS_FAILED', result.error.message, 400)
      }

      return apiSuccess({ success: true })
    } catch (err) {
      return serverError(err)
    }
  })
}
