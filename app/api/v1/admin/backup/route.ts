import { serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
import { exportBackupBrowser } from '@/lib/api/v1/services/browser-operations'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      return serviceResultResponse(await exportBackupBrowser(auth.actor))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
