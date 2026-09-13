// app/api/branding/logo/route.ts
import { NextResponse } from 'next/server'
import { getCachedBranding } from '@/lib/branding-server'
import { fetchSafeImage } from '@/lib/branding-proxy'
import { requireSuperAdmin } from '@/app/actions/_shared'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const previewUrl = url.searchParams.get('preview')

    let targetUrl: string
    let isPreview = false

    if (previewUrl) {
      const gate = await requireSuperAdmin()
      if ('error' in gate) {
        return new NextResponse(null, { status: 403 })
      }
      targetUrl = previewUrl
      isPreview = true
    } else {
      const branding = await getCachedBranding()
      if (!branding.logoUrl) {
        return new NextResponse(null, { status: 404 })
      }
      targetUrl = branding.logoUrl
    }

    const { buffer, contentType, etag } = await fetchSafeImage(targetUrl)

    const ifNoneMatch = request.headers.get('if-none-match')
    if (ifNoneMatch === etag && !isPreview) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } })
    }

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      // Bounded lifetime with a content-bound ETag (sha256 of the served
      // bytes): browsers revalidate after 5 min so a changed logo appears
      // promptly, while ETag/304 keeps repeated views cheap. SVG is rejected
      // upstream in fetchSafeImage (see lib/branding-proxy.ts).
      'Cache-Control': isPreview
        ? 'private, no-cache, no-store, must-revalidate'
        : 'public, max-age=300, must-revalidate, stale-while-revalidate=3600',
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
    }

    return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
