import { withMobileActor, json, serverError } from '@/app/api/v1/_http'
import { getReferenceService } from '@/lib/api/v1/services/reference'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const allActivityTypes = new URL(request.url).searchParams.get('all') === '1'
      const data = await getReferenceService(auth.actor, { allActivityTypes })
      return json({ data, error: null })
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
