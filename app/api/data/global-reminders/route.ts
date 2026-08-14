// app/api/data/global-reminders/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'

export async function GET(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const all = new URL(request.url).searchParams.get('all') === '1'
    const data = all
      ? await repo.listGlobalReminders(auth.actor)
      : await repo.listDueGlobalReminders(auth.actor)
    return json({ data })
  } catch (err) {
    return serverError(err)
  }
}
