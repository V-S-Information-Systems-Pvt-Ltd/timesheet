// app/api/auth/domain-check/route.ts
// GET pre-signup whitelist lookup used by the Supabase client flow. Returns
// whether an email's domain is whitelisted and whether signup auto-activates.
// The public.profiles handle_new_user trigger is the enforcement backstop; this
// route is the friendly client-side pre-check so the UI can reject
// non-whitelisted domains before calling Supabase. Unauthenticated (signup is
// the unauthenticated flow) and read-only.
import { json } from '@/app/api/_http'
import { repo } from '@/lib/db'
import { reserveRateLimit } from '@/lib/rate-limit'
import { logger, extractError } from '@/lib/logger'
import { getClientIp } from '@/lib/ip'

export async function GET(request: Request) {
  // Unauthenticated, so rate-limit per-IP to stop this being used as an
  // enumeration oracle (which domain is whitelisted) that bypasses the
  // signup route's limiter. Every probe counts, so the reservation is never
  // released.
  const ip = getClientIp(request)
  const reservation = await reserveRateLimit('daily-signup', `domaincheck:${ip}`)
  if (!reservation.ok) {
    logger.warn('rate limit: domain check exceeded', { ip, retryAfter: reservation.retryAfter })
    return json(
      { allowed: false, autoActivate: false, error: 'Too many attempts. Try again later.' },
      429,
      { 'Retry-After': String(reservation.retryAfter) }
    )
  }

  const email = new URL(request.url).searchParams.get('email') ?? ''
  const domain = email.trim().toLowerCase().split('@')[1]?.toLowerCase()
  if (!domain) {
    return json({ allowed: false, autoActivate: false, error: 'Please enter a valid email address.' }, 400)
  }

  try {
    const whitelisted = await repo.findWhitelistedDomain(domain)
    if (!whitelisted) return json({ allowed: false, autoActivate: false })
    return json({ allowed: true, autoActivate: Boolean(whitelisted.auto_activate) })
  } catch (err) {
    logger.error(extractError(err))
    return json({
      allowed: false,
      autoActivate: false,
      error: 'Failed to check registration domain.',
    })
  }
}
