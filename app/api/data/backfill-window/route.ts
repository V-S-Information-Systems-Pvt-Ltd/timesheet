// app/api/data/backfill-window/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { workspaceDeps } from '@/lib/db/workspace'
import { getBackfillSettings } from '@/lib/domain/workspace'

export async function GET() {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response
    const result = await getBackfillSettings(auth.actor, workspaceDeps())
    if (!result.ok) return json({ error: result.error.message }, 403)
    return json({ data: result.data })
  } catch (err) {
    return serverError(err)
  }
}
