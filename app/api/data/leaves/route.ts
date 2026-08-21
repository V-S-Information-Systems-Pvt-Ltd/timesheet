// app/api/data/leaves/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'
import type { LeafQuery } from '@/lib/data/client'

export async function GET(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const opts: LeafQuery = {}
    if (url.searchParams.get('userId')) opts.userId = url.searchParams.get('userId')!
    if (url.searchParams.get('from')) opts.from = url.searchParams.get('from')!
    if (url.searchParams.get('to')) opts.to = url.searchParams.get('to')!

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
    const rows = body?.rows
    if (!Array.isArray(rows)) return json({ error: 'rows must be an array.' }, 400)

    const result = await repo.createLeaves(auth.actor, rows)
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
