import 'server-only'

import { cache } from 'react'
import { getActor, getSessionUser } from '@/lib/auth'

/** RSC request scope only. HTTP handlers deliberately use the fresh facade. */
export const getRenderIdentity = cache(async () => {
  const actor = await getActor()
  const identity = actor ?? await getSessionUser()
  return {
    actor,
    session: identity ? { id: identity.id, email: identity.email } : null,
  }
})
