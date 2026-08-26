import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { parseSchema, reminderSchema } from '@/lib/validation-schemas'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const data = await repo.listReminders(auth.actor, auth.actor.id)
    return json({ data, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400)
    }

    const parsed = parseSchema(reminderSchema, {
      message: (body as { message?: unknown })?.message,
      remindAt: (body as { remindAt?: unknown })?.remindAt,
    })
    if (!parsed.ok) {
      return apiError('VALIDATION_ERROR', parsed.error.error, 400)
    }

    const result = await repo.createReminder(auth.actor, {
      userId: auth.actor.id,
      message: parsed.data.message,
      remindAt: new Date(parsed.data.remindAt).toISOString(),
    })

    if (result.error) return apiError('DB_ERROR', result.error, 400)
    return json({ data: { success: true }, error: null }, 201)
  } catch (err) {
    return serverError(err)
  }
}
