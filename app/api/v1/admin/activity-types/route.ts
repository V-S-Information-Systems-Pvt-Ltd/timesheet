import { apiError, withMobileActor, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { createActivityTypeAdmin, createActivityTypeBrowser, listActivityTypesAdmin } from '@/lib/api/v1/services/reference-admin'
import { browserActivityTypeCreateSchema } from '@vsis/contracts'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      return serviceResultResponse(await listActivityTypesAdmin(auth.actor))
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const body = await request.json().catch(() => null)
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return apiError('VALIDATION_ERROR', 'An activity type object is required.', 400)
      }
      if (auth.via === 'cookie') {
        const parsed = browserActivityTypeCreateSchema.safeParse(body)
        if (!parsed.success) {
          return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'An activity type object is required.', 400)
        }
        return serviceResultResponse(await createActivityTypeBrowser(auth.actor, parsed.data.name), 201)
      }
      const name = typeof body.name === 'string' ? body.name : ''
      const telegramNo = typeof body.telegramNo === 'number' ? body.telegramNo : null

      return serviceResultResponse(await createActivityTypeAdmin(auth.actor, { name, telegramNo }), 201)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
