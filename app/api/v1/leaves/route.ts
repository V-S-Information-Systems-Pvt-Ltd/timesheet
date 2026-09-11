import { withMobileActor, json, serverError, apiError, parseJsonBody } from '@/app/api/v1/_http'
import { getLeavesService, createLeavesService } from '@/lib/api/v1/services/leaves'
import { withIdempotency } from '@/lib/idempotency'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const url = new URL(request.url)
      const raw: Record<string, unknown> = {}
      for (const key of ['userId', 'from', 'to'] as const) {
        const value = url.searchParams.get(key)
        if (value !== null && value !== '') raw[key] = value
      }

      const result = await getLeavesService(auth.actor, raw)
      if (!result.success) {
        return apiError(result.code, result.message, result.status)
      }

      return json({ data: result.data, error: null })
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const parsedBody = await parseJsonBody(request)
      if (!parsedBody.ok) return parsedBody.response
      const body = parsedBody.body

      return await withIdempotency(request, auth.actor.id, 'create_leave', body, async () => {
        const result = await createLeavesService(auth.actor, body)
        if (!result.success) {
          return apiError(result.code, result.message, result.status)
        }
        return json({ data: result.data, error: null }, result.status ?? 201)
      }, { successStatus: 201 })
    } catch (err) {
      return serverError(err)
    }
  })
}
