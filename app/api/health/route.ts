// app/api/health/route.ts
// Liveness/readiness probe endpoint for container platforms (OpenShift/Rancher).
// Returns 503 when the active backend is not reachable/configured, so external
// monitoring (probes), can use it to drive restarts/alerts.

import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db/pool'
import { IS_NATIVE } from '@/lib/backend/config'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

async function checkDatabase() {
  if (IS_NATIVE) {
    const url = process.env.DATABASE_URL
    if (!url) return { reachable: false, mode: 'native', error: 'DATABASE_URL is not set' }
    try {
      await Promise.race([
        getPool().query('select 1'),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 2000)),
      ])
      return { reachable: true, mode: 'native' }
    } catch (err) {
      return { reachable: false, mode: 'native', error: err instanceof Error ? err.message : String(err) }
    }
  }

  // Supabase hosted mode: verify the project URL is reachable (not just that a
  // key is present), so a misconfigured/missing backend is reported as unhealthy.
  if (!SUPABASE_URL) {
    return { reachable: false, mode: 'supabase', error: 'SUPABASE_URL is not set' }
  }
  try {
    await Promise.race([
      fetch(SUPABASE_URL, { method: 'HEAD', signal: AbortSignal.timeout(2000) }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ])
    return { reachable: true, mode: 'supabase' }
  } catch (err) {
    return { reachable: false, mode: 'supabase', error: err instanceof Error ? err.message : String(err) }
  }
}

export async function GET() {
  const db = await checkDatabase()
  // Auth is "configured" only when the required keys for the active backend exist.
  // ADMIN_EMAIL / ADMIN_PASSWORD are seed-only (see README), so they must NOT be
  // required here — a production native deployment would otherwise report
  // unhealthy (503) spuriously once the seed vars are removed.
  const authConfigured = IS_NATIVE
    ? !!process.env.AUTH_SECRET
    : !!(SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  const healthy = db.reachable && authConfigured
  const status = healthy ? 200 : 503

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      commit: process.env.GIT_COMMIT ?? null,
      backend: IS_NATIVE ? 'native' : 'supabase',
      db,
      authConfigured,
    },
    { status }
  )
}
