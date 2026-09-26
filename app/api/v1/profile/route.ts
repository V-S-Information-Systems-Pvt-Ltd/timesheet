import { apiError, apiSuccess, serverError, withMobileActor } from '@/app/api/v1/_http'
import { peopleDeps } from '@/lib/db/people'
import { getSelfProfileDomain } from '@/lib/domain/people'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const result = await getSelfProfileDomain(auth.actor, peopleDeps())
      if (!result.ok) {
        return apiError('FORBIDDEN', result.error.message, 403)
      }
      return apiSuccess(result.data)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true, allowInactive: true })
}
