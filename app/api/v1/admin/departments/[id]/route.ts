import { apiError, serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import { deleteDepartmentService, renameDepartmentService } from '@/lib/api/v1/services/departments'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params
      const body = await request.json().catch(() => null) as { name?: unknown } | null
      if (typeof body?.name !== 'string') return apiError('VALIDATION_ERROR', 'A department name is required.', 400)
      return serviceResultResponse(await renameDepartmentService(auth.actor, id, body.name))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params
      return serviceResultResponse(await deleteDepartmentService(auth.actor, id))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
