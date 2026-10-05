import { serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import { deleteLastTimesheetService, getLastTimesheetService } from '@/lib/api/v1/services/timesheets'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try { return serviceResultResponse(await getLastTimesheetService(auth.actor)) }
    catch (err) { return serverError(err) }
  }, { allowCookie: true })
}

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
