// app/api/auth/login/route.ts
import { json, serverError } from '@/app/api/_http'
import { setSessionCookie, signIn, signSessionToken } from '@/lib/auth/native'
import { getRetryAfter, rateLimit } from '@/lib/rate-limit'
import { loginSchema } from '@/lib/validation-schemas'

export async function POST(request: Request) {
  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' }, 400)
  }
  const { email, password } = parsed.data

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  if (!rateLimit(`login:${ip}`, 5, 15 * 60 * 1000)) {
    const retryAfter = getRetryAfter(`login:${ip}`) ?? 900
    return json({ error: 'Too many login attempts. Please try again later.' }, 429, { 'Retry-After': String(retryAfter) })
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
