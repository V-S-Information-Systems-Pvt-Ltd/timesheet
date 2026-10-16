import 'server-only'

import { signIn } from './native'
import type { SessionUser } from './index'

export async function verifyMobileCredentials(
  email: string,
  password: string
): Promise<{ user: SessionUser | null; error: string | null }> {
  return signIn(email, password)
}
