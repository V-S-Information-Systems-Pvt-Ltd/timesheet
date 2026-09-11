import { withMobileActor, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { listPeopleService } from '@/lib/api/v1/services/people'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const result = await listPeopleService(auth.actor)
      return serviceResultResponse(result)
    } catch (err) {
      return serverError(err)
    }
  })
}
