import { apiError, serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import {
  deleteWhitelistedDomainBrowser,
  updateWhitelistedDomainBrowser,
} from '@/lib/api/v1/services/superadmin'
import { browserWhitelistedDomainUpdateSchema } from '@vsis/contracts'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const parsed = browserWhitelistedDomainUpdateSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'An update is required.', 400)
      }
      const { id } = await params
      return serviceResultResponse(
        await updateWhitelistedDomainBrowser(auth.actor, id, parsed.data.autoActivate)
      )
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params
      return serviceResultResponse(await deleteWhitelistedDomainBrowser(auth.actor, id))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
