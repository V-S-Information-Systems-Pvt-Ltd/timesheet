// app/api/data/projects/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { referenceDeps } from '@/lib/db/reference'
import { listProjects } from '@/lib/domain/reference'

export async function GET() {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response
    const result = await listProjects(auth.actor, referenceDeps())
    if (!result.ok) throw new Error(result.error.message)
    return json({ data: result.data })
  } catch (err) {
    return serverError(err)
  }
}
