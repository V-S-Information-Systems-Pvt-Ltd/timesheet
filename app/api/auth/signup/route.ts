import { json, originCheck, serverError } from '@/app/api/_http'
import { hashPassword } from '@/lib/auth/password'
import { passwordSchema } from '@/lib/validation-schemas'
import { getClientIp } from '@/lib/ip'
import { repo } from '@/lib/db'
import { query } from '@/lib/db/pool'
import {
  checkRateLimit,
  dailySignupStore,
  getRetryAfter,
  RATE_LIMIT_SIGNUP,
  WINDOWS,
} from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

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

  const pwdCheck = passwordSchema.safeParse(password)
  if (!pwdCheck.success) {
    const msg = pwdCheck.error.issues[0]?.message ?? 'Password does not meet complexity requirements.'
    return json({ error: msg }, 400)
  }

  // Bound the optional display name: this endpoint is unauthenticated, so an
  // uncapped value would be stored verbatim in profiles.name.
  const displayName = typeof name === 'string' ? name.trim() : ''
  if (displayName.length > 200) {
    return json({ error: 'Name is too long.' }, 400)
  }

  const domain = normalizedEmail.split('@')[1]?.toLowerCase()
  if (!domain) {
    return json({ error: 'Invalid email address.' }, 400)
  }

  // Rate limit by IP (hourly window) to slow brute-force scrypt burn and
  // account-enumeration scans. Every signup attempt consumes budget so an
  // attacker cannot endlessly probe whether a domain is whitelisted or an
  // email already exists.
  const ip = getClientIp(request)
  const key = `signup:${ip}`
  const limit = checkRateLimit(dailySignupStore, key, RATE_LIMIT_SIGNUP, WINDOWS.hour)
  if (!limit.ok) {
    const retry = getRetryAfter(limit.resetAt)
    logger.warn('rate limit: signup exceeded', { ip, retryAfter: retry })
    return json({ error: 'Too many signup attempts. Try again later.' }, 429, {
      'Retry-After': String(retry),
    })
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
    const isActive = Boolean(whitelisted.auto_activate)

    await query(
      `insert into public.profiles (email, name, password_hash, is_active, permission_role, hierarchy_role)
       values ($1, $2, $3, $4, 'user', 'user')`,
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
