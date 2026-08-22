// app/api/auth/signup/route.ts
import { json, originCheck, serverError } from '@/app/api/_http'
import { hashPassword } from '@/lib/auth/password'
import { repo } from '@/lib/db'
import { query } from '@/lib/db/pool'

export async function POST(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const { email, password, name } = (body ?? {}) as {
    email?: unknown
    password?: unknown
    name?: unknown
  }

  if (typeof email !== 'string' || typeof password !== 'string') {
    return json({ error: 'Email and password are required.' }, 400)
  }

  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return json({ error: 'Please enter a valid email address.' }, 400)
  }

  if (password.length < 6) {
    return json({ error: 'Password must be at least 6 characters.' }, 400)
  }

  const domain = normalizedEmail.split('@')[1]?.toLowerCase()
  if (!domain) {
    return json({ error: 'Invalid email address.' }, 400)
  }

  try {
    const whitelisted = await repo.findWhitelistedDomain(domain)
    if (!whitelisted) {
      return json(
        { error: `Registration is not allowed for @${domain}. Contact an administrator.` },
        403
      )
    }

    const existing = await repo.getProfileByEmail(normalizedEmail)
    if (existing) {
      return json({ error: 'An account with that email already exists.' }, 409)
    }

    const hash = await hashPassword(password)
    const displayName = typeof name === 'string' ? name.trim() : ''
    const isActive = Boolean(whitelisted.auto_activate)

    await query(
      `insert into public.profiles (email, name, password_hash, is_active, role)
       values ($1, $2, $3, $4, 'user')`,
      [normalizedEmail, displayName, hash, isActive]
    )

    return json({
      success: true,
      isActive,
      message: isActive
        ? 'Account created and activated! You can now sign in.'
        : 'Account created! An administrator must activate your account before you can log time.',
    })
  } catch (err) {
    return serverError(err)
  }
}
