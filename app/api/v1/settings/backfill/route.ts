import { apiError, apiSuccess, serverError, withMobileActor } from '@/app/api/v1/_http'
import { workspaceDeps } from '@/lib/db/workspace'
import { getBackfillSettings } from '@/lib/domain/workspace'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const result = await getBackfillSettings(auth.actor, workspaceDeps())
      if (!result.ok) {
        if (result.error.code === 'FORBIDDEN') {
          return apiError('FORBIDDEN', result.error.message, 403)
        }
        return serverError(result.error.message)
      }
      return apiSuccess(result.data)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
