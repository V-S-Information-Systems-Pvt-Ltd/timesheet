// app/api/auth/logout/route.ts
import { json, originCheck } from '@/app/api/_http'
import { clearSessionCookie } from '@/lib/auth/native'

export async function POST(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  await clearSessionCookie()
  return json({ ok: true })
}

