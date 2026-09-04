import { requireMobileSession, json, serverError } from '@/app/api/v1/_http'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const auth = await requireMobileSession(request)
    if (!auth.ok) return auth.response
    await mobileSessionStore.revokeSession(auth.sessionId)
    return json({ data: { ok: true }, error: null })
  } catch (err) {
    return serverError(err)
  }
}
