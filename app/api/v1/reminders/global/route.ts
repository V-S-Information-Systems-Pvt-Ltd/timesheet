import { withMobileActor, apiSuccess, apiError, serverError } from '@/app/api/v1/_http'
import { mapGlobalReminderDto } from '@/lib/api/v1/contracts'
import { leaveReminderDeps } from '@/lib/db/leave-reminders'
import { listDueGlobalReminders } from '@/lib/domain/leave-reminders'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const result = await listDueGlobalReminders(auth.actor, leaveReminderDeps())
      if (!result.ok) return apiError('FORBIDDEN', result.error.message, 403)
      return apiSuccess(result.data.map(mapGlobalReminderDto))
    } catch (err) {
      return serverError(err)
    }
  })
}
