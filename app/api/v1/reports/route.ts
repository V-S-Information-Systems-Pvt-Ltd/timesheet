import { withMobileActor, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { getReportsService } from '@/lib/api/v1/services/reports'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const url = new URL(request.url)
      const result = await getReportsService(auth.actor, url.searchParams)
      return serviceResultResponse(result)
    } catch (err) {
      return serverError(err)
    }
  })
}
