import { serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import { listDepartmentsService } from '@/lib/api/v1/services/departments'

export const runtime = 'nodejs'

/** The department list is readable by every active member (profile pickers). */
export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      return serviceResultResponse(await listDepartmentsService(auth.actor))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
