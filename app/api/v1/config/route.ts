import { BACKEND } from '@/lib/backend/config'
import { repo } from '@/lib/db'
import { DEFAULT_BRANDING } from '@/lib/branding'

export const runtime = 'nodejs'

import { isMobileBearerAuthEnabled } from '@/lib/auth/mobile-config'

/**
 * Public bootstrap metadata for native clients. This deliberately exposes
 * capabilities and safe branding, not secrets or backend credentials, so a client can validate
 * that it is talking to a compatible Timesheet server before signing in.
 */
export async function GET() {
  const brandingRes = await repo.getBranding().catch(() => ({ data: DEFAULT_BRANDING, error: null }))
  const branding = brandingRes.data ?? DEFAULT_BRANDING

  return Response.json(
    {
      data: {
        apiVersion: 1,
        appVersion: process.env.npm_package_version ?? '0.1.0',
        backend: BACKEND,
        capabilities: {
          // Keep mobile bearer rollout fail-closed until every platform has
          // proven OS-backed refresh-token storage.
          bearerAuth: isMobileBearerAuthEnabled(),
          mobileApi: true,
        },
        branding,
      },
      error: null,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  )
}
