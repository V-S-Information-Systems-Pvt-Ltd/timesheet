import { apiError, serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import { createDepartmentService } from '@/lib/api/v1/services/departments'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const body = await request.json().catch(() => null) as { name?: unknown } | null
      if (typeof body?.name !== 'string') return apiError('VALIDATION_ERROR', 'A department name is required.', 400)
      return serviceResultResponse(await createDepartmentService(auth.actor, body.name), 201)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
