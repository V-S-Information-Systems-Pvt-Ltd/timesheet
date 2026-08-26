// app/api/data/leaves/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'
import { leaveQuerySchema, leaveRowsSchema, parseSchema } from '@/lib/validation-schemas'
import type { LeafQuery } from '@/lib/data/client'

export async function GET(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const raw: Record<string, unknown> = {}
    for (const key of ['userId', 'from', 'to'] as const) {
      const value = url.searchParams.get(key)
      if (value !== null && value !== '') raw[key] = value
    }
    const parsed = parseSchema(leaveQuerySchema, raw)
    if (!parsed.ok) return json({ error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }, 400)

    const opts: LeafQuery = parsed.data

    const data = await repo.listLeaves(auth.actor, opts)
    return json({ data })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireActive(request)
    if (!auth.ok) return auth.response

    const body = await request.json()
    // Validate row shape/dates/count at the boundary so malformed input gets a
    // clean 400 instead of surfacing as a backend date-cast/not-null error.
    const parsed = parseSchema(leaveRowsSchema, body?.rows)
    if (!parsed.ok) return json({ error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }, 400)

    const result = await repo.createLeaves(auth.actor, parsed.data)
    return json(result)
  } catch (err) {
    return serverError(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireActive(request)
    if (!auth.ok) return auth.response


    const id = new URL(request.url).searchParams.get('id')
    if (!id) return json({ error: 'Missing id.' }, 400)

    const result = await repo.deleteLeave(auth.actor, id)
    return json(result)
  } catch (err) {
    return serverError(err)
  }
}
