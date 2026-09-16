import { withMobileActor, apiSuccess, serverError, apiError } from '@/app/api/v1/_http'
import {
  createAdminUserService,
  listAdminUsersService,
} from '@/lib/api/v1/services/admin-users'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const result = await listAdminUsersService(auth.actor)
      if (!result.success) return apiError(result.code, result.message, result.status)
      return apiSuccess(result.data)
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const body = await request.json().catch(() => ({}))
      const result = await createAdminUserService(auth.actor, body)
      if (!result.success) return apiError(result.code, result.message, result.status)
      return apiSuccess(result.data, result.status ?? 201)
    } catch (err) {
      return serverError(err)
    }
  })
}
