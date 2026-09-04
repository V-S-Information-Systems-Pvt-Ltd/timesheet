import { json, apiError, serverError } from '@/app/api/v1/_http'
import { hashPassword } from '@/lib/auth/password'
import { passwordSchema } from '@/lib/validation-schemas'
import { getClientIp } from '@/lib/ip'
import { repo } from '@/lib/db'
import { query } from '@/lib/db/pool'
import { reserveRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

export async function POST(request: Request) {
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
    return apiError('VALIDATION_ERROR', 'Email and password are required.', 400)
  }

  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return apiError('VALIDATION_ERROR', 'Please enter a valid email address.', 400)
  }

  const pwdCheck = passwordSchema.safeParse(password)
  if (!pwdCheck.success) {
    const msg = pwdCheck.error.issues[0]?.message ?? 'Password does not meet complexity requirements.'
    return apiError('VALIDATION_ERROR', msg, 400)
  }

  const displayName = typeof name === 'string' ? name.trim() : ''
  if (displayName.length > 200) {
    return apiError('VALIDATION_ERROR', 'Name is too long.', 400)
  }

  const domain = normalizedEmail.split('@')[1]?.toLowerCase()
  if (!domain) {
    return apiError('VALIDATION_ERROR', 'Invalid email address.', 400)
  }

  const ip = getClientIp(request)
  const reservation = await reserveRateLimit('daily-signup', `signup:${ip}`)
  if (!reservation.ok) {
    logger.warn('rate limit: v1 signup exceeded', { ip, retryAfter: reservation.retryAfter })
    return apiError('RATE_LIMITED', 'Too many signup attempts. Try again later.', 429, {
      'Retry-After': String(reservation.retryAfter),
    })
  }

  try {
    const whitelisted = await repo.findWhitelistedDomain(domain)
    if (!whitelisted) {
      return apiError(
        'DOMAIN_NOT_ALLOWED',
        `Registration is not allowed for @${domain}. Contact an administrator.`,
        403
      )
    }

    const existing = await repo.getProfileByEmail(normalizedEmail)
    if (existing) {
      return apiError('ACCOUNT_EXISTS', 'An account with that email already exists.', 409)
    }

    const hash = await hashPassword(password)
    const isActive = Boolean(whitelisted.auto_activate)

    await query(
      `insert into public.profiles (email, name, password_hash, is_active, permission_role, hierarchy_role)
       values ($1, $2, $3, $4, 'user', 'user')`,
      [normalizedEmail, displayName, hash, isActive]
    )

    return json(
      {
        data: {
          success: true,
          isActive,
          message: isActive
            ? 'Account created and activated! You can now sign in.'
            : 'Account created! An administrator must activate your account before you can log time.',
        },
        error: null,
      },
      201
    )
  } catch (err) {
    return serverError(err)
  }
}
