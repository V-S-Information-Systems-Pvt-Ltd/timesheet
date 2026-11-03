import { withMobileActor, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { getReportLeavesService } from '@/lib/api/v1/services/reports'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const url = new URL(request.url)
      const result = await getReportLeavesService(auth.actor, url.searchParams)
      return serviceResultResponse(result)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
