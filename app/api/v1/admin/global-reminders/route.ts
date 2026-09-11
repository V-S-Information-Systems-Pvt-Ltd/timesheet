import { withMobileActor, json, serverError, apiError, badRequest, parseJsonBody } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { parseSchema, reminderSchema } from '@/lib/validation-schemas'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      if (auth.actor.permission_role !== 'admin') {
        return apiError('FORBIDDEN', 'Only administrators can manage global reminders.', 403)
      }

      const reminders = await repo.listGlobalReminders(auth.actor)
      return json({ data: reminders, error: null })
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      if (auth.actor.permission_role !== 'admin') {
        return apiError('FORBIDDEN', 'Only administrators can create global reminders.', 403)
      }

      const parsedBody = await parseJsonBody(request)
      if (!parsedBody.ok) return parsedBody.response
      const body = parsedBody.body

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

      // The adapter returns the inserted row atomically. No list fallback: a
      // follow-up read could observe an intervening delete and return an
      // unrelated row.
      const data = ('data' in result && result.data) ? result.data : null
      if (!data) {
        return serverError(new Error('Global reminder created but no row was returned.'))
      }
      return json({ data, error: null }, 201)
    } catch (err) {
      return serverError(err)
    }
  })
}
