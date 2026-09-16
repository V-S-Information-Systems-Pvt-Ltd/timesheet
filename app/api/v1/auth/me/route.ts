import { withMobileSession, withMobileActor, apiSuccess, apiError, serverError } from '@/app/api/v1/_http'
import { mapActorDto } from '@/lib/api/v1/contracts'
import { peopleDeps, peoplePersistence } from '@/lib/db/people'
import { updateOwnProfileDomain } from '@/lib/domain/people'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileSession(request, async (auth) => {
    try {
      return apiSuccess(mapActorDto(auth.actor))
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function PATCH(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const body = await request.json().catch(() => null)
      if (!body || typeof body !== 'object') {
        return apiError('INVALID_INPUT', 'Request body must be a JSON object', 400)
      }

      const department = typeof body.department === 'string' ? body.department.trim() : auth.actor.department || ''
      const title = typeof body.title === 'string' ? body.title.trim() : auth.actor.title || ''

      // Self-profile policy (including the title/hierarchy rule) is owned by the
      // people service; this transport only maps the domain result.
      const result = await updateOwnProfileDomain(auth.actor, { department, title }, peopleDeps())
      if (!result.ok) {
        return apiError('PROFILE_UPDATE_FAILED', result.error.message, 400)
      }

      const updatedProfile = await peoplePersistence.getProfileById(auth.actor.id)
      if (!updatedProfile) {
        return apiError('NOT_FOUND', 'Profile not found', 404)
      }

      const updatedActor = {
        ...auth.actor,
        department: updatedProfile.department || '',
        title: updatedProfile.title || '',
        name: updatedProfile.name || auth.actor.name,
      }

      return apiSuccess(mapActorDto(updatedActor))
    } catch (err) {
      return serverError(err)
    }
  })
}
