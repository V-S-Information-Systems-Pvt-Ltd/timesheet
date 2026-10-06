import { batchUpdateTimesheetsSchema } from '@vsis/contracts'
import { parseSchema } from '@/lib/validation-schemas'
import { batchUpdateTimesheetsService } from '@/lib/api/v1/services/timesheets'
import { apiError, parseJsonBody, serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'

import { timesheetFormatResponse } from '@/lib/timesheet-format'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const incompatible = timesheetFormatResponse(request)
      if (incompatible) return incompatible
      const body = await parseJsonBody(request)
      if (!body.ok) return body.response
      const entries = body.body && typeof body.body === 'object' && 'entries' in body.body
        ? body.body.entries : undefined
      if (!Array.isArray(entries) || entries.length === 0) {
        return apiError('VALIDATION_ERROR', 'No entries selected.', 400)
      }
      if (entries.length > 500) {
        return apiError('VALIDATION_ERROR', 'Too many entries for one edit (max 500).', 400)
      }
      const parsed = parseSchema(batchUpdateTimesheetsSchema, body.body)
      if (!parsed.ok) return apiError('VALIDATION_ERROR', parsed.error.error, 400)
      // Direct browser write: preserve the action's one-charge/partial-result
      // lifecycle without adding queued retries or ledger-only replay.
      const result = await batchUpdateTimesheetsService(auth.actor, parsed.data.entries)
      return serviceResultResponse(result)
    } catch (err) {
      return serverError(err, { requestId: auth.requestId })
    }
  }, { allowCookie: true })
}
