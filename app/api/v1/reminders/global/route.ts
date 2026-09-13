import { withMobileActor, apiSuccess, serverError } from '@/app/api/v1/_http'
import { mapGlobalReminderDto } from '@/lib/api/v1/contracts'
import { repo } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const dueReminders = await repo.listDueGlobalReminders(auth.actor)
      return apiSuccess(dueReminders.map(mapGlobalReminderDto))
    } catch (err) {
      return serverError(err)
    }
  })
}
