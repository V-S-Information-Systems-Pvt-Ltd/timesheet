import { withMobileActor, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { listOrgTreeService, listPeopleService } from '@/lib/api/v1/services/people'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const org = new URL(request.url).searchParams.get('scope') === 'org'
      const result = await (org ? listOrgTreeService : listPeopleService)(auth.actor)
      return serviceResultResponse(result)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
