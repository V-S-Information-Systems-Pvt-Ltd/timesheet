import { withMobileActor, json, apiSuccess, serverError, apiError, badRequest, parseJsonBody } from '@/app/api/v1/_http'
import { leaveReminderDeps } from '@/lib/db/leave-reminders'
import { createGlobalReminder, listGlobalReminders } from '@/lib/domain/leave-reminders'
import { browserGlobalReminderCreateSchema } from '@vsis/contracts'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      if (auth.actor.permission_role !== 'admin') {
        return apiError('FORBIDDEN', 'Only administrators can manage global reminders.', 403)
      }

      const result = await listGlobalReminders(auth.actor, leaveReminderDeps())
      if (!result.ok) return apiError('FORBIDDEN', result.error.message, 403)
      return apiSuccess(result.data)
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
      let body = parsedBody.body
      if (auth.via === 'cookie') {
        const parsed = browserGlobalReminderCreateSchema.safeParse(body)
        if (!parsed.success) {
          return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'A global reminder object is required.', 400)
        }
        body = parsed.data
      }

      const result = await createGlobalReminder(
        auth.actor,
        body as Record<string, unknown>,
        leaveReminderDeps()
      )
      if (!result.ok) {
        if (result.error.code === 'VALIDATION_ERROR') {
          return badRequest(result.error.message)
        }
        return apiError('BAD_REQUEST', result.error.message, 400)
      }

      if (auth.via === 'cookie') return apiSuccess({ success: true })

      // The adapter returns the inserted row atomically. No list fallback: a
      // follow-up read could observe an intervening delete and return an
      // unrelated row.
      const data = result.data
      if (!data) {
        return serverError(new Error('Global reminder created but no row was returned.'))
      }
      return json({ data, error: null }, 201)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
