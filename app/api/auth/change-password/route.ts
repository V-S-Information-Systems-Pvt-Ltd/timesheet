// app/api/auth/change-password/route.ts
import { json, serverError } from '@/app/api/_http'
import { getSessionUser } from '@/lib/auth'
import { changePassword } from '@/lib/auth/native'

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return json({ error: 'You must be signed in.' }, 401)

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const { currentPassword, newPassword } = (body ?? {}) as {
    currentPassword?: unknown
    newPassword?: unknown
  }

  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return json({ error: 'Current and new password are required.' }, 400)
  }
  if (newPassword.length < 6) {
    return json({ error: 'New password must be at least 6 characters.' }, 400)
  }

  try {
    const { error } = await changePassword(session.id, currentPassword, newPassword)
    return json({ error })
  } catch (err) {
    return serverError(err)
  }
}
