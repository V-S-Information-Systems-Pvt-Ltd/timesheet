import { apiSuccess, serverError, withMobileActor } from '@/app/api/v1/_http'
import { isSuperAdminActor } from '@/lib/roles'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      return apiSuccess({ isSuperAdmin: isSuperAdminActor(auth.actor) })
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
