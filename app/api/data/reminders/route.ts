// app/api/data/reminders/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'
import { parseSchema, reminderSchema } from '@/lib/validation-schemas'

export async function GET() {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response
    const data = await repo.listReminders(auth.actor, auth.actor.id)
    return json({ data })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireActive(request)
    if (!auth.ok) return auth.response

    const body = await request.json()
    // Validate at the boundary (same rules as the global-reminder Server
    // Action) so empty/garbage input gets a clean 400 instead of a backend
    // timestamp-cast error.
    const parsed = parseSchema(reminderSchema, { message: body?.message, remindAt: body?.remindAt })
    if (!parsed.ok) return json({ error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }, 400)

    const result = await repo.createReminder(auth.actor, {
      userId: auth.actor.id,
      message: parsed.data.message,
      remindAt: new Date(parsed.data.remindAt).toISOString(),
    })
    return json(result)
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

    const result = await repo.updateReminder(auth.actor, id, {
      done: Boolean(body?.done),
    })
    return json(result)
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

    const result = await repo.deleteReminder(auth.actor, id)
    return json(result)
  } catch (err) {
    return serverError(err)
  }
}

