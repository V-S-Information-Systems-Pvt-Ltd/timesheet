import { createHash, timingSafeEqual } from 'node:crypto'
import { json, serverError, apiError } from '@/app/api/v1/_http'
import { operationsDeps } from '@/lib/db/operations'
import { runScheduledMaintenance } from '@/lib/domain/operations'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

/**
 * Length-independent constant-time comparison.
 *
 * `timingSafeEqual` throws on length mismatch, and comparing lengths first would
 * leak the secret's length. Hashing both sides to a fixed width first removes
 * both problems.
 */
function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    const secretHeader = request.headers.get('x-cron-secret')
    const cronSecret = process.env.CRON_SECRET

    // Fail CLOSED when unconfigured. This endpoint expires sessions for every
    // user, so an unauthenticated caller must never reach it — previously an
    // unset secret allowed anonymous cleanup, which meant a deployment that
    // simply forgot the variable exposed it. 503 (not 403) says "the server is
    // misconfigured", which is the actionable signal for an operator.
    if (!cronSecret) {
      logger.error('Cron cleanup rejected: CRON_SECRET is not configured')
      return apiError(
        'NOT_CONFIGURED',
        'Scheduled cleanup is not configured on this server.',
        503
      )
    }

    const token = authHeader?.replace(/^Bearer\s+/i, '') || secretHeader

    if (!token || !secretsMatch(token, cronSecret)) {
      // Never log the presented token/secret — only whether headers were present.
      logger.warn('Unauthorized cron cleanup attempt', {
        hasAuthHeader: Boolean(authHeader),
        hasSecretHeader: Boolean(secretHeader),
      })
      return apiError('FORBIDDEN', 'Invalid or missing cron secret.', 403)
    }

    // Cleanup/maintenance is coordinator-owned and unreachable through an
    // ordinary-user credential: the only valid input is the explicit scheduled
    // authorization minted after the cron-secret gate above.
    const outcome = await runScheduledMaintenance({ kind: 'scheduled' }, operationsDeps())
    if (!outcome.ok) {
      logger.error('Failed to run scheduled cleanup', { error: outcome.error.message })
      return apiError('FORBIDDEN', outcome.error.message, 403)
    }

    return json({
      data: {
        cleanedSessions: outcome.data.cleanedSessions,
        cleanedRateLimits: outcome.data.cleanedRateLimits,
        cleanedIdempotencyKeys: outcome.data.cleanedIdempotencyKeys,
        timestamp: new Date().toISOString(),
      },
      error: null,
    })
  } catch (err) {
    logger.error('Failed to run scheduled cleanup', {
      error: err instanceof Error ? err.message : String(err),
    })
    return serverError(err)
  }
}

// Vercel Cron invokes configured paths with GET. Keep the same secret-gated
// implementation for Kubernetes (POST) and Vercel (GET) schedulers.
export const GET = POST
