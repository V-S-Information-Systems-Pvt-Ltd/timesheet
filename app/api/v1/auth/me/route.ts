import { requireMobileSession, requireMobileActor, json, apiError, serverError } from '@/app/api/v1/_http'
import { mapActorDto } from '@/lib/api/v1/contracts'
import { repo } from '@/lib/db'

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

export async function PATCH(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return apiError('INVALID_INPUT', 'Request body must be a JSON object', 400)
    }

    const department = typeof body.department === 'string' ? body.department.trim() : auth.actor.department || ''
    const title = typeof body.title === 'string' ? body.title.trim() : auth.actor.title || ''

    const result = await repo.updateMyProfile(auth.actor, { department, title })
    if (result.error) {
      return apiError('PROFILE_UPDATE_FAILED', result.error, 400)
    }

    const updatedProfile = await repo.getProfileById(auth.actor.id)
    if (!updatedProfile) {
      return apiError('NOT_FOUND', 'Profile not found', 404)
    }

    const updatedActor = {
      ...auth.actor,
      department: updatedProfile.department || '',
      title: updatedProfile.title || '',
      name: updatedProfile.name || auth.actor.name,
    }

    return json({
      data: mapActorDto(updatedActor),
      error: null,
    })
  } catch (err) {
    return serverError(err)
  }
}
