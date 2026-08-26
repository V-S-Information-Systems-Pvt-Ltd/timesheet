import { BACKEND } from '@/lib/backend/config'

export const runtime = 'nodejs'

/**
 * Public bootstrap metadata for native clients. This deliberately exposes
 * capabilities, not secrets or backend credentials, so a client can validate
 * that it is talking to a compatible Timesheet server before signing in.
 */
export async function GET() {
  return Response.json(
    {
      data: {
        apiVersion: 1,
        appVersion: process.env.npm_package_version ?? '0.1.0',
        backend: BACKEND,
        capabilities: {
          bearerAuth: false,
          mobileApi: true,
        },
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
