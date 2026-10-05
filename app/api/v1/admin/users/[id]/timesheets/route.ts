import { serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import { deleteUserTimesheetsBrowser } from '@/lib/api/v1/services/browser-operations'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params
      return serviceResultResponse(await deleteUserTimesheetsBrowser(auth.actor, id))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
