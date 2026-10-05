import 'server-only'

import { NextResponse } from 'next/server'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function hasTrustedProxy(): boolean {
  if (process.env.VERCEL) return true
  return /^[1-9]\d*$/.test(process.env.TRUSTED_PROXY_HOPS?.trim() ?? '')
}

/** Reject cross-origin state-mutating requests that authenticate with cookies. */
export function originCheck(request: Request): Response | null {
  if (SAFE_METHODS.has(request.method)) return null

  const origin = request.headers.get('origin')
  // Clients can forge X-Forwarded-Host when the app is directly reachable.
  // Accept it only when the deployment explicitly declares a trusted proxy
  // chain (or when running behind Vercel's managed edge).
  const host = hasTrustedProxy()
    ? request.headers.get('x-forwarded-host') || request.headers.get('host')
    : request.headers.get('host')
  const referer = request.headers.get('referer')
  const target = origin || referer

  if (!target || !host) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Missing Origin or Referer header.' }, { status: 403 })
    }
    return null
  }

  try {
    const originHost = new URL(target).host
    if (originHost.toLowerCase() !== host.toLowerCase()) {
      return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid Origin header.' }, { status: 403 })
  }
  return null
}
