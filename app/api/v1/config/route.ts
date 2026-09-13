import { BACKEND } from '@/lib/backend/config'
import { workspaceDeps } from '@/lib/db/workspace'
import { getBrandingOrDefault } from '@/lib/domain/workspace'
import { APP_VERSION } from '@/lib/version'

export const runtime = 'nodejs'

import { isMobileBearerAuthEnabled, isDurableIdempotencyEnabled } from '@/lib/auth/mobile-config'

/**
 * Public bootstrap metadata for native clients. This deliberately exposes
 * capabilities and safe branding, not secrets or backend credentials, so a client can validate
 * that it is talking to a compatible Timesheet server before signing in.
 */
export async function GET() {
  const branding = await getBrandingOrDefault(workspaceDeps())

  return Response.json(
    {
      data: {
        apiVersion: 1,
        appVersion: process.env.APP_VERSION || process.env.npm_package_version || APP_VERSION,
        backend: BACKEND,
        capabilities: {
          // Keep mobile bearer rollout fail-closed until every platform has
          // proven OS-backed refresh-token storage.
          bearerAuth: isMobileBearerAuthEnabled(),
          mobileApi: true,
          durableIdempotency: isDurableIdempotencyEnabled(),
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
