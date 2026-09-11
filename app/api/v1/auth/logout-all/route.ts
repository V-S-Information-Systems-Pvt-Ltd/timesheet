import { withMobileSession, apiSuccess, serverError } from '@/app/api/v1/_http'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return withMobileSession(request, async (auth) => {
    try {
      await mobileSessionStore.revokeAll(auth.actor.id)
      return apiSuccess({ ok: true })
    } catch (err) {
      return serverError(err)
    }
  })
}
