import { requireMobileActor, json, serverError } from '@/app/api/v1/_http'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'

import { withRequestLogging } from '../../_observability'
export const runtime = 'nodejs'

export const POST = withRequestLogging('POST /api/v1/auth/logout-all', async (request: Request) => {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response
    await mobileSessionStore.revokeAll(auth.actor.id)
    return json({ data: { ok: true }, error: null })
  } catch (err) {
    return serverError(err)
  }
})
