import { json, serverError, apiError } from '@/app/api/v1/_http'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    const secretHeader = request.headers.get('x-cron-secret')
    const cronSecret = process.env.CRON_SECRET

    const token = authHeader?.replace(/^Bearer\s+/i, '') || secretHeader

    // If CRON_SECRET is configured, strictly enforce it; in local dev allow if unset
    if (cronSecret && token !== cronSecret) {
      logger.warn('Unauthorized cron cleanup attempt', {
        hasAuthHeader: Boolean(authHeader),
        hasSecretHeader: Boolean(secretHeader),
      })
      return apiError('FORBIDDEN', 'Invalid or missing cron secret.', 403)
    }

    const cleanedCount = await mobileSessionStore.cleanupExpired()
    logger.info('Completed scheduled mobile session cleanup', {
      cleanedCount,
    })

    return json({
      data: {
        cleanedSessions: cleanedCount,
        timestamp: new Date().toISOString(),
      },
      error: null,
    })
  } catch (err) {
    logger.error('Failed to run scheduled mobile session cleanup', {
      error: err instanceof Error ? err.message : String(err),
    })
    return serverError(err)
  }
}
