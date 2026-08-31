import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { getLeavesService, createLeavesService } from '@/lib/api/v1/services/leaves'
import { isAdminActor } from '@/lib/roles'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (!isAdminActor(auth.actor) && auth.actor.hierarchy_role !== 'manager' && auth.actor.hierarchy_role !== 'team_lead') {
      return apiError('FORBIDDEN', 'Only managers, leads, and administrators can manage team leaves.', 403)
    }

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
}

export async function POST(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (!isAdminActor(auth.actor) && auth.actor.hierarchy_role !== 'manager' && auth.actor.hierarchy_role !== 'team_lead') {
      return apiError('FORBIDDEN', 'Only managers, leads, and administrators can create leave markers.', 403)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400)
    }

    const result = await createLeavesService(auth.actor, body)
    if (!result.success) {
      return apiError(result.code, result.message, result.status)
    }

    return json({ data: result.data, error: null }, result.status ?? 201)
  } catch (err) {
    return serverError(err)
  }
}
