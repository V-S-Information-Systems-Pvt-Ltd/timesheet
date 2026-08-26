import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { parseSchema, leaveQuerySchema, leaveRowsSchema } from '@/lib/validation-schemas'
import type { LeafQuery } from '@/lib/data/client'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const raw: Record<string, unknown> = {}
    for (const key of ['userId', 'from', 'to'] as const) {
      const value = url.searchParams.get(key)
      if (value !== null && value !== '') raw[key] = value
    }
    const parsed = parseSchema(leaveQuerySchema, raw)
    if (!parsed.ok) {
      return apiError('VALIDATION_ERROR', parsed.error.error, 400)
    }

    const opts: LeafQuery = parsed.data
    const data = await repo.listLeaves(auth.actor, opts)
    return json({ data, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400)
    }

    const parsed = parseSchema(leaveRowsSchema, (body as { rows?: unknown })?.rows ?? body)
    if (!parsed.ok) {
      return apiError('VALIDATION_ERROR', parsed.error.error, 400)
    }

    const result = await repo.createLeaves(auth.actor, parsed.data)
    if (result.error) return apiError('DB_ERROR', result.error, 400)
    return json({ data: { success: true }, error: null }, 201)
  } catch (err) {
    return serverError(err)
  }
}
