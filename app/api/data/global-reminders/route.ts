// app/api/data/global-reminders/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { leaveReminderDeps } from '@/lib/db/leave-reminders'
import { listDueGlobalReminders, listGlobalReminders } from '@/lib/domain/leave-reminders'

export async function GET(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const all = new URL(request.url).searchParams.get('all') === '1'
    const result = all
      ? await listGlobalReminders(auth.actor, leaveReminderDeps())
      : await listDueGlobalReminders(auth.actor, leaveReminderDeps())
    if (!result.ok) return json({ error: result.error.message }, 403)
    return json({ data: result.data })
  } catch (err) {
    return serverError(err)
  }
}
