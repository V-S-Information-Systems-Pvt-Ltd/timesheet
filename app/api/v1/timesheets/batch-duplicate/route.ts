import { withMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { parseSchema, batchDuplicateTimesheetsSchema } from '@/lib/validation-schemas'
import { batchDuplicateTimesheetsService, reauthorizeBatchDuplicateStored } from '@/lib/api/v1/services/timesheets'
import { withIdempotency } from '@/lib/idempotency'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400, {
          'x-request-id': auth.requestId,
        })
      }

      const parsed = parseSchema(batchDuplicateTimesheetsSchema, body)
      if (!parsed.ok) {
        return apiError('VALIDATION_ERROR', parsed.error.error, 400, {
          'x-request-id': auth.requestId,
        })
      }

      return await withIdempotency(
        request,
        auth.actor.id,
        'batch_duplicate_timesheets',
        parsed.data,
        async () => {
          const result = await batchDuplicateTimesheetsService(auth.actor, parsed.data.items)
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
        },
        {
          // Batch duplicate replays return the stored entry DTOs; recheck
          // access to every source entry before replaying them.
          reauthorize: async (stored) => {
            if (!stored) return null
            const payload = 'payload' in stored ? stored.payload : undefined
            const checked = await reauthorizeBatchDuplicateStored(auth.actor, payload)
            if (checked.ok) return null
            return apiError(checked.code, checked.message, checked.status, {
              'x-request-id': auth.requestId,
            })
          },
        }
      )
    } catch (err) {
      return serverError(err, { requestId: auth.requestId })
    }
  })
}
