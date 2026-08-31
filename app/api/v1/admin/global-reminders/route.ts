import { requireMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { parseSchema, reminderSchema } from '@/lib/validation-schemas'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin') {
      return apiError('FORBIDDEN', 'Only administrators can manage global reminders.', 403)
    }

    const reminders = await repo.listGlobalReminders(auth.actor)
    return json({ data: reminders, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin') {
      return apiError('FORBIDDEN', 'Only administrators can create global reminders.', 403)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return badRequest('A JSON request body is required.')
    }

    const parsed = parseSchema(reminderSchema, body)
    if (!parsed.ok) {
      return badRequest(parsed.error.error)
    }

    const remindAt = new Date(parsed.data.remindAt)
    const result = await repo.createGlobalReminder(auth.actor, {
      message: parsed.data.message.trim(),
      remindAt: remindAt.toISOString(),
    })

    if (result.error) {
      return apiError('BAD_REQUEST', result.error, 400)
    }

    const all = await repo.listGlobalReminders(auth.actor)
    return json({ data: all[0] ?? { success: true }, error: null }, { status: 201 })
  } catch (err) {
    return serverError(err)
  }
}
