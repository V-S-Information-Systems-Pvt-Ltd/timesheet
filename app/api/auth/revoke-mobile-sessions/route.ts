import { json, originCheck, serverError } from '@/app/api/_http'
import { getSessionUser } from '@/lib/auth'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  try {
    const user = await getSessionUser()
    if (!user) return json({ error: 'You must be signed in.' }, 401, { 'Cache-Control': 'no-store' })
    await mobileSessionStore.revokeAll(user.id)
    return json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    return serverError(err)
  }
}
