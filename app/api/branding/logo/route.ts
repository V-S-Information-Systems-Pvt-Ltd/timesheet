// app/api/branding/logo/route.ts
import { NextResponse } from 'next/server'
import { getCachedBranding } from '@/lib/branding-server'
import { fetchSafeImage } from '@/lib/branding-proxy'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const branding = await getCachedBranding()
    if (!branding.logoUrl) {
      return new NextResponse(null, { status: 404 })
    }

    const { buffer, contentType, etag } = await fetchSafeImage(branding.logoUrl)

    const ifNoneMatch = request.headers.get('if-none-match')
    if (ifNoneMatch === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } })
    }

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
    }

    if (contentType === 'image/svg+xml') {
      headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'"
    }

    return new NextResponse(buffer, { status: 200, headers })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
