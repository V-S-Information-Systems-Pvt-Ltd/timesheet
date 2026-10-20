import { apiError, serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import { setDepartmentScopeService } from '@/lib/api/v1/services/departments'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PUT(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params
      const body = await request.json().catch(() => null) as { departments?: unknown } | null
      const departments = body?.departments
      if (!Array.isArray(departments) || departments.length > 100 || !departments.every(d => typeof d === 'string' && d.length <= 100)) {
        return apiError('VALIDATION_ERROR', 'departments must be a list of department names.', 400)
      }
      return serviceResultResponse(await setDepartmentScopeService(auth.actor, id, departments))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
