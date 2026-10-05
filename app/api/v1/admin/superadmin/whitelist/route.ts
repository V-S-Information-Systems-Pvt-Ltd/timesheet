import { apiError, serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import {
  addWhitelistedDomainBrowser,
  listWhitelistedDomainsBrowser,
} from '@/lib/api/v1/services/superadmin'
import { browserWhitelistedDomainCreateSchema } from '@vsis/contracts'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      return serviceResultResponse(await listWhitelistedDomainsBrowser(auth.actor))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const parsed = browserWhitelistedDomainCreateSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'A domain is required.', 400)
      }
      return serviceResultResponse(
        await addWhitelistedDomainBrowser(auth.actor, parsed.data.domain, parsed.data.autoActivate),
        201
      )
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
