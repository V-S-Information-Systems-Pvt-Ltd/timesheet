import { requireMobileActor, json, serverError } from '@/app/api/v1/_http'
import { mapGlobalReminderDto } from '@/lib/api/v1/contracts'
import { repo } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const dueReminders = await repo.listDueGlobalReminders(auth.actor)
    return json({
      data: dueReminders.map(mapGlobalReminderDto),
      error: null,
    })
  } catch (err) {
    return serverError(err)
  }
}
