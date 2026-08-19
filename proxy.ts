// proxy.ts
// Minimal edge middleware: guard /api/super-admin/* routes so only
// authenticated sessions can reach them. Authorization (role + email)
// is still enforced server-side in the route handlers / server actions.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifySessionToken } from '@/lib/auth/jwt'

const SUPER_ADMIN_PATHS = ['/api/super-admin']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isSuperAdminPath = SUPER_ADMIN_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))
  if (!isSuperAdminPath) return NextResponse.next()

  const sessionToken = request.cookies.get('vsis_session')?.value
  if (!sessionToken) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  try {
    const user = await verifySessionToken(sessionToken)
    if (!user) {
      return NextResponse.json({ error: 'Invalid session.' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 })
  }

  return NextResponse.next()
}
