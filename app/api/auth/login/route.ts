// app/api/auth/login/route.ts
import { json, serverError } from '@/app/api/_http'
import { setSessionCookie, signIn, signSessionToken } from '@/lib/auth/native'

export async function POST(request: Request) {
  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown }

  if (typeof email !== 'string' || typeof password !== 'string') {
    return json({ error: 'Email and password are required.' }, 400)
  }

  try {
    const { user, error } = await signIn(email.trim().toLowerCase(), password)
    if (error || !user) {
      return json({ error: error ?? 'Invalid email or password.' }, 401)
    }

    await setSessionCookie(await signSessionToken(user))
    return json({ user })
  } catch (err) {
    return serverError(err)
  }
}
