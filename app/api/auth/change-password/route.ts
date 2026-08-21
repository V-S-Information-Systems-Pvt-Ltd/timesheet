// app/api/auth/change-password/route.ts
import { json, originCheck, serverError } from '@/app/api/_http'
import { getSessionUser } from '@/lib/auth'
import { changePassword } from '@/lib/auth/native'
import { passwordSchema } from '@/lib/validation-schemas'

export async function POST(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

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
  const check = passwordSchema.safeParse(newPassword)
  if (!check.success) {
    return json({ error: check.error.issues[0]?.message ?? 'Invalid password.' }, 400)
  }

  try {
    const { error } = await changePassword(session.id, currentPassword, newPassword)
    return json({ error })
  } catch (err) {
    return serverError(err)
  }
}
