import { apiError, apiSuccess, parseJsonBody, serverError, withMobileActor } from '@/app/api/v1/_http'
import { issueFreshKeys, type FreshKeyOperation } from '@/lib/idempotency-fresh-key'
import { reserveWriteRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const parsed = await parseJsonBody(request)
      if (!parsed.ok) return parsed.response
      const body = parsed.body as Record<string, unknown> | null
      const operation = body?.operation
      const count = body?.count ?? 1
      if ((operation !== 'create_reminder' && operation !== 'create_leave') ||
          !Number.isInteger(count) || (count as number) < 1 || (count as number) > 20) {
        return apiError('INVALID_TICKET_REQUEST', 'A supported operation and count from 1 to 20 are required.', 400)
      }
      const rate = await reserveWriteRateLimit(auth.actor.id)
      if (!rate.ok) {
        return apiError('RATE_LIMITED', rate.error, 429, { 'retry-after': String(rate.retryAfter) })
      }
      const tickets = await issueFreshKeys(auth.actor.id, operation as FreshKeyOperation, count as number)
      if (!tickets) return apiError('WRITERS_FENCED', 'Fresh operations cannot be admitted without an open migration gate.', 503)
      return apiSuccess({ tickets })
    } catch (error) {
      return serverError(error)
    }
  })
}
