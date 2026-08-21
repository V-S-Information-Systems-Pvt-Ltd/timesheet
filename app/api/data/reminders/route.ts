// app/api/data/reminders/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'

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
    const result = await repo.createReminder(auth.actor, {
      userId: auth.actor.id,
      message: String(body?.message ?? ''),
      remindAt: String(body?.remindAt ?? ''),
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
    const result = await repo.updateReminder(auth.actor, String(body?.id ?? ''), {
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

