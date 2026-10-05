import { json, parseJsonBody, serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import { createYesterdayTimesheetService } from '@/lib/api/v1/services/timesheets'
import { addDaysISO, todayISO } from '@/lib/dates'
import { logYesterdaySchema, parseSchema } from '@/lib/validation-schemas'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const parsedBody = await parseJsonBody(request)
      if (!parsedBody.ok) return parsedBody.response

      const parsed = parseSchema(logYesterdaySchema, parsedBody.body)
      if (!parsed.ok) {
        return json({
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.error,
            fieldErrors: parsed.error.fieldErrors,
          },
        }, 400)
      }

      const logDate = addDaysISO(todayISO(), -1)
      const payload = { ...parsed.data, logDate }
      // Preserve the action's server-date semantics. Recomputing yesterday on
      // a later queued retry would change the date, so this is a direct write.
      const result = await createYesterdayTimesheetService(auth.actor, payload)
      return serviceResultResponse(result, 201)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
