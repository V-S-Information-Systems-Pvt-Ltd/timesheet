import { withMobileActor, apiSuccess, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { updateAdminUserService } from '@/lib/api/v1/services/admin-users'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id: targetId } = await params
      if (!targetId) return badRequest('User ID is required.')

      const body = await request.json().catch(() => ({}))
      const result = await updateAdminUserService(auth.actor, targetId, body)
      if (!result.success) return apiError(result.code, result.message, result.status)
      return apiSuccess(result.data)
    } catch (err) {
      return serverError(err)
    }
  })
}
