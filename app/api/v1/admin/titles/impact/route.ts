import { withMobileActor, apiError, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { getTitleImpactAdmin } from '@/lib/api/v1/services/reference-admin'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import type { HierarchyRole } from '@/app/types'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      if (!isSuperAdmin(auth.actor)) {
        return apiError('FORBIDDEN', 'Super-admin access required to check title impact.', 403)
      }

      const url = new URL(request.url)
      const name = url.searchParams.get('name')?.trim() || ''
      const proposedRole = url.searchParams.get('proposedRole') as HierarchyRole | null

      return serviceResultResponse(
        await getTitleImpactAdmin(auth.actor, name, proposedRole ?? undefined)
      )
    } catch (err) {
      return serverError(err)
    }
  })
}
