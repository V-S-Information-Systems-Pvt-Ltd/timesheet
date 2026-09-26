import { serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import { deleteLastTimesheetService } from '@/lib/api/v1/services/timesheets'

export const runtime = 'nodejs'

export async function DELETE(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const result = await deleteLastTimesheetService(auth.actor)
      return serviceResultResponse(result)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
