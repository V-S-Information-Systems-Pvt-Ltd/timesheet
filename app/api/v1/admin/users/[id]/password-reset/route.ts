import { withMobileActor, apiSuccess, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { adminPasswordResetService } from '@/lib/api/v1/services/admin-users'

export const runtime = 'nodejs'

// A generated password is in the response body; never cache it.
const NO_STORE = { 'Cache-Control': 'no-store, private' }

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id: targetId } = await params
      if (!targetId) return badRequest('User ID is required.', NO_STORE)

      const body = await request.json().catch(() => ({}))
      const result = await adminPasswordResetService(auth.actor, targetId, body)
      if (!result.success) return apiError(result.code, result.message, result.status, NO_STORE)
      return apiSuccess(result.data, 200, NO_STORE)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
