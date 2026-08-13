// app/api/auth/logout/route.ts
import { json } from '@/app/api/_http'
import { clearSessionCookie } from '@/lib/auth/native'

export async function POST() {
  await clearSessionCookie()
  return json({ ok: true })
}
