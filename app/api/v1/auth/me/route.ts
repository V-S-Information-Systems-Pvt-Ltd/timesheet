import { requireMobileSession, json, serverError } from '@/app/api/v1/_http'
import { mapActorDto } from '@/lib/api/v1/contracts'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileSession(request)
    if (!auth.ok) return auth.response
    return json({
      data: mapActorDto(auth.actor),
      error: null,
    })
  } catch (err) {
    return serverError(err)
  }
}
