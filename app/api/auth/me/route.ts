// app/api/auth/me/route.ts
import { json } from '@/app/api/_http'
import { getSessionUser } from '@/lib/auth'

export async function GET() {
  const user = await getSessionUser()
  return json({ user })
}
