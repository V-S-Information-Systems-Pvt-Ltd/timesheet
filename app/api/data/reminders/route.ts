// app/api/data/reminders/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { leaveReminderDeps, unthrottledWriteBudget } from '@/lib/db/leave-reminders'
import {
  createReminder,
  deleteReminder,
  listReminders,
  updateReminder,
} from '@/lib/domain/leave-reminders'

// The compatibility `/api/data` transports historically enforced no per-user
// write budget, so they compose the domain with the unthrottled budget while
// still routing every operation through the shared application service.
const deps = () => leaveReminderDeps({ writeBudget: unthrottledWriteBudget })

export async function GET() {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response
    const result = await listReminders(auth.actor, deps())
    if (!result.ok) return json({ error: result.error.message }, 403)
    return json({ data: result.data })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireActive(request)
    if (!auth.ok) return auth.response

    const body = await request.json()
    // Validate at the boundary/domain (same rules as the global-reminder Server
    // Action) so empty/garbage input gets a clean 400 instead of a backend
    // timestamp-cast error.
    const result = await createReminder(
      auth.actor,
      { message: body?.message, remindAt: body?.remindAt },
      deps()
    )
    if (!result.ok) {
      if (result.error.code === 'VALIDATION_ERROR') {
        return json({ error: result.error.message, fieldErrors: result.error.details?.fieldErrors }, 400)
      }
      return json({ error: result.error.message })
    }
    return json({ error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireActive(request)
    if (!auth.ok) return auth.response

    const body = await request.json()
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    if (!id) return json({ error: 'Missing reminder id.' }, 400)

    const result = await updateReminder(auth.actor, id, { done: body?.done }, deps())
    if (!result.ok) return json({ error: result.error.message })
    return json({ error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireActive(request)
    if (!auth.ok) return auth.response

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return json({ error: 'Missing id.' }, 400)

    const result = await deleteReminder(auth.actor, id, deps())
    if (!result.ok) return json({ error: result.error.message })
    return json({ error: null })
  } catch (err) {
    return serverError(err)
  }
}
