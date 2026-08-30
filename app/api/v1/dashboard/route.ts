import { requireMobileActor, json, serverError } from '@/app/api/v1/_http'
import { getDashboardService } from '@/lib/api/v1/services/dashboard'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  let reqId: string | undefined
  try {
    const auth = await requireMobileActor(request)
    reqId = auth.requestId
    if (!auth.ok) return auth.response

    const data = await getDashboardService(auth.actor)
    const durationMs = Math.round(performance.now() - auth.startTime)

    logger.info('v1 request completed', {
      requestId: auth.requestId,
      userId: auth.actor.id,
      route: '/api/v1/dashboard',
      status: 200,
      durationMs,
    })

    return json(
      { data, error: null },
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
