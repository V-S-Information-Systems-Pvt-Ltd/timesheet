import { withMobileSession, apiSuccess, serverError } from '@/app/api/v1/_http'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { revokeAllMobileSessions } from '@/lib/auth/identity-service'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return withMobileSession(request, async (auth) => {
    try {
      await revokeAllMobileSessions(auth.actor.id, { sessions: mobileSessionStore })
      return apiSuccess({ ok: true })
    } catch (err) {
      return serverError(err)
    }
  })
}
