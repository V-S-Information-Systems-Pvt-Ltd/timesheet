import { apiError, withMobileActor, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { createProjectAdmin, createProjectBrowser, listProjectsAdmin } from '@/lib/api/v1/services/reference-admin'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      return serviceResultResponse(await listProjectsAdmin(auth.actor))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const body = await request.json().catch(() => ({}))
      if (auth.via === 'cookie' && (!body || typeof body !== 'object' || Array.isArray(body))) {
        return apiError('VALIDATION_ERROR', 'A project object is required.', 400)
      }
      const name = typeof body.name === 'string' ? body.name : ''
      if (auth.via === 'cookie') {
        return serviceResultResponse(await createProjectBrowser(auth.actor, name), 201)
      }
      const soNumber = typeof body.soNumber === 'string' ? body.soNumber : null
      const telegramNo = typeof body.telegramNo === 'number' ? body.telegramNo : null

      return serviceResultResponse(
        await createProjectAdmin(auth.actor, { name, soNumber, telegramNo }),
        201
      )
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
