import { NextResponse, type NextRequest } from 'next/server'
import { isMaintenanceMode } from '@/lib/maintenance'

// Enumerate assets, never exempt arbitrary extensions (including dotted APIs).
const PUBLIC_ASSETS = new Set([
  '/favicon.ico',
  '/icon.png',
  '/brand/vsis-logo.jpg',
  '/brand/vsis-logo-compact.jpg',
  '/fonts/WorkSans-Variable.ttf',
  '/fonts/GeistMono-Variable.woff2',
  '/fonts/Geist-Variable.woff2',
  '/file.svg',
  '/globe.svg',
  '/next.svg',
  '/vercel.svg',
  '/window.svg',
])

function isReadExempt(pathname: string): boolean {
  return pathname === '/maintenance'
    || pathname === '/api/health'
    || pathname === '/api/health/live'
    || pathname.startsWith('/_next/static/')
    || pathname === '/_next/image'
    || PUBLIC_ASSETS.has(pathname)
    || (process.env.NODE_ENV === 'development' && (
      pathname === '/_next/webpack-hmr'
      || pathname === '/__nextjs_source-map'
    ))
}

export function proxy(request: NextRequest) {
  if (!isMaintenanceMode()) return NextResponse.next()

  const { pathname } = request.nextUrl
  const isRead = request.method === 'GET' || request.method === 'HEAD'
  if (isRead && isReadExempt(pathname)) {
    const response = NextResponse.next()
    if (pathname === '/maintenance') response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const headers = { 'Cache-Control': 'no-store', 'Retry-After': '60' }
  if (!isRead || pathname === '/api' || pathname.startsWith('/api/')) {
    const message = 'The application is temporarily unavailable for maintenance. Please try again shortly.'
    const body = pathname === '/api/v1' || pathname.startsWith('/api/v1/')
      ? { data: null, error: { code: 'MAINTENANCE_MODE', message } }
      : { error: message }
    return NextResponse.json(body, { status: 503, headers })
  }

  // Construct a fresh URL so tokens and other original query data are discarded.
  return NextResponse.redirect(new URL('/maintenance', request.url), { status: 307, headers })
}

// All methods/paths must reach the gate, including Server Action POSTs and assets.
export const config = { matcher: '/:path*' }
