import { withMobileActor, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { createProjectAdmin, listProjectsAdmin } from '@/lib/api/v1/services/reference-admin'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      return serviceResultResponse(await listProjectsAdmin(auth.actor))
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const body = await request.json().catch(() => ({}))
      const name = typeof body.name === 'string' ? body.name : ''
      const soNumber = typeof body.soNumber === 'string' ? body.soNumber : null
      const telegramNo = typeof body.telegramNo === 'number' ? body.telegramNo : null

      return serviceResultResponse(
        await createProjectAdmin(auth.actor, { name, soNumber, telegramNo }),
        201
      )
    } catch (err) {
      return serverError(err)
    }
  })
}
