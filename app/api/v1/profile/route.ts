import { apiError, apiSuccess, serverError, withMobileActor } from '@/app/api/v1/_http'
import { peopleDeps } from '@/lib/db/people'
import { getSelfProfileDomain, updateOwnProfileDomain } from '@/lib/domain/people'
import { browserProfileUpdateSchema } from '@vsis/contracts'

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

export async function PATCH(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const body = await request.json().catch(() => null)
      const parsed = browserProfileUpdateSchema.safeParse(body)
      if (!parsed.success) {
        return apiError(
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'A profile update object is required.',
          400
        )
      }
      const result = await updateOwnProfileDomain(auth.actor, parsed.data, peopleDeps())
      if (!result.ok) {
        return apiError(
          result.error.code === 'STORAGE_ERROR' ? 'BAD_REQUEST' : result.error.code,
          result.error.message,
          result.error.code === 'FORBIDDEN' ? 403 : 400
        )
      }
      return apiSuccess({ success: true })
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
