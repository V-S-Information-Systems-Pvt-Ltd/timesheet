import { apiError, serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import { deleteUserBrowser, setTestUserBrowser } from '@/lib/api/v1/services/superadmin'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params
      const body = await request.json().catch(() => null) as { isTestUser?: unknown } | null
      if (typeof body?.isTestUser !== 'boolean') return apiError('VALIDATION_ERROR', 'isTestUser must be a boolean.', 400)
      return serviceResultResponse(await setTestUserBrowser(auth.actor, id, body.isTestUser))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params
      return serviceResultResponse(await deleteUserBrowser(auth.actor, id))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
