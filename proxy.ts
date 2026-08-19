// proxy.ts
// Edge guard for /api/super-admin/* routes. This is the Next.js 16 proxy
// (the successor to the deprecated middleware.ts) and runs on the edge for
// every request matched below. Defense-in-depth: it blocks unauthenticated
// and non-super-admin sessions before they reach the route handlers. The
// AUTHORITATIVE role/email check is still enforced server-side in the route
// handlers / server actions (see app/actions.ts isSuperAdmin + requireRole).

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth/jwt'

export const config = {
  // Scope the edge guard to the super-admin routes so it does not run on every
  // request (static assets, other API routes, pages).
  matcher: ['/api/super-admin/:path*'],
}

export async function proxy(request: NextRequest) {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value
  if (!sessionToken) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  let user: { id: string; email: string } | null
  try {
    user = await verifySessionToken(sessionToken)
  } catch {
    user = null
  }
  if (!user) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 })
  }

  // The session JWT carries identity (id + email) but not role; the role check
  // happens server-side. At the edge, additionally require the configured
  // super-admin account when one is set, so non-super-admin sessions are
  // rejected before reaching the handler.
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()
  if (superAdminEmail && user.email.toLowerCase() !== superAdminEmail) {
    return NextResponse.json({ error: 'You do not have permission to perform this action.' }, { status: 403 })
  }

  return NextResponse.next()
}
