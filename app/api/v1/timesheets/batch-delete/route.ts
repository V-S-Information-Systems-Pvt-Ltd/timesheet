import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { parseSchema, batchDeleteTimesheetsSchema } from '@/lib/validation-schemas'
import { batchDeleteTimesheetsService } from '@/lib/api/v1/services/timesheets'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  let reqId: string | undefined
  try {
    const auth = await requireMobileActor(request)
    reqId = auth.requestId
    if (!auth.ok) return auth.response

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400, {
        'x-request-id': auth.requestId,
      })
    }

    const parsed = parseSchema(batchDeleteTimesheetsSchema, body)
    if (!parsed.ok) {
      return apiError('VALIDATION_ERROR', parsed.error.error, 400, {
        'x-request-id': auth.requestId,
      })
    }

    const result = await batchDeleteTimesheetsService(auth.actor, parsed.data.ids)
    if (!result.ok) {
      return apiError(result.error.code, result.error.message, result.error.status, {
        'x-request-id': auth.requestId,
      })
    }

    const durationMs = Math.round(performance.now() - auth.startTime)
    return json(
      { data: result.data, error: null },
      200,
      {
        'x-request-id': auth.requestId,
        'x-response-time': `${durationMs}ms`,
      }
    )
  } catch (err) {
    return serverError(err, { requestId: reqId })
  }
}
