// app/api/data/projects/route.ts
import { json, requireSignedIn, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'

export async function GET() {
  try {
    const auth = await requireSignedIn()
    if (!auth.ok) return auth.response
    const data = await repo.listProjects(auth.actor)
    return json({ data })
  } catch (err) {
    return serverError(err)
  }
}
