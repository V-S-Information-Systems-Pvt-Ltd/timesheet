// app/api/health/route.ts
// Liveness/readiness probe endpoint for container platforms (OpenShift/Rancher).
// Lightweight: checks DB connectivity and auth configuration.

import { NextResponse } from 'next/server'
import { Pool } from 'pg'
import { IS_NATIVE } from '@/lib/backend/config'

async function checkDatabase() {
  const url = process.env.DATABASE_URL
  if (!url || !IS_NATIVE) return { reachable: true, mode: 'skipped' }
  const pool = new Pool({ connectionString: url })
  try {
    await Promise.race([
      pool.query('select 1'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 2000)),
    ])
    return { reachable: true, mode: 'native' }
  } catch (err) {
    return { reachable: false, mode: 'native', error: err instanceof Error ? err.message : String(err) }
  } finally {
    await pool.end().catch(() => {})
  }
}

export async function GET() {
  const db = await checkDatabase()
  const authConfigured = IS_NATIVE
    ? !!(process.env.AUTH_SECRET && process.env.ADMIN_EMAIL)
    : !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  const healthy = db.reachable && authConfigured
  const status = healthy ? 200 : 503

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      backend: IS_NATIVE ? 'native' : 'supabase',
      db,
      authConfigured,
    },
    { status }
  )
}
