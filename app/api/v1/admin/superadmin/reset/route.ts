import { apiError, serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import { resetDatabaseBrowser } from '@/lib/api/v1/services/superadmin'
import { browserSuperadminResetSchema } from '@vsis/contracts'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const parsed = browserSuperadminResetSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'A reset mode is required.', 400)
      }
      return serviceResultResponse(await resetDatabaseBrowser(auth.actor, parsed.data.mode))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
