// app/api/data/leaves/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { leaveReminderDeps, unthrottledWriteBudget } from '@/lib/db/leave-reminders'
import { createLeaves, deleteLeave, listLeaves } from '@/lib/domain/leave-reminders'

// The compatibility `/api/data` transports historically enforced no per-user
// write budget, so they compose the domain with the unthrottled budget while
// still routing every operation through the shared application service.
const deps = () => leaveReminderDeps({ writeBudget: unthrottledWriteBudget })

export async function GET(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const raw: Record<string, unknown> = {}
    for (const key of ['userId', 'from', 'to'] as const) {
      const value = url.searchParams.get(key)
      if (value !== null && value !== '') raw[key] = value
    }

    const result = await listLeaves(auth.actor, raw, deps())
    if (!result.ok) {
      if (result.error.code === 'VALIDATION_ERROR') {
        return json({ error: result.error.message, fieldErrors: result.error.details?.fieldErrors }, 400)
      }
      return json({ error: result.error.message }, 403)
    }
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
    // Validate row shape/dates/count inside the domain so malformed input gets
    // a clean 400 instead of surfacing as a backend date-cast/not-null error.
    const result = await createLeaves(auth.actor, body?.rows, deps())
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

export async function DELETE(request: Request) {
  try {
    const auth = await requireActive(request)
    if (!auth.ok) return auth.response

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return json({ error: 'Missing id.' }, 400)

    const result = await deleteLeave(auth.actor, id, deps())
    if (!result.ok) return json({ error: result.error.message })
    return json({ error: null })
  } catch (err) {
    return serverError(err)
  }
}
