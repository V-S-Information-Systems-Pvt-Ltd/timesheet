// app/api/health/route.ts
// Liveness/readiness probe endpoint for container platforms (OpenShift/Rancher).
// Returns 503 when the active backend is not reachable/configured, so external
// monitoring (probes) can use it to drive restarts/alerts.
//
// The response body is minimal by default: `{ status }` only. Container probes
// read the status code, not the body (see deploy/deployment.yaml), so the
// version, commit, backend mode, pool metrics, and dependency error text that
// used to be returned unconditionally were reconnaissance value with no
// operational consumer. They are still produced — but into the server log, and
// into the response only when HEALTH_DEBUG is exactly "true".

import { NextResponse } from 'next/server'
import { getPool, getPoolMetrics } from '@/lib/db/pool'
import { logger } from '@/lib/logger'
import { APP_VERSION } from '@/lib/version'
import { secretProblem } from '@/lib/secret-env'

/** Never cache: a stale "ok" would mask an outage from probes and dashboards. */
const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Verbose output is opt-in and strict: only the exact string "true" enables it.
 * Anything else — unset, "1", "TRUE", "yes", "false" — stays minimal, so a
 * typo in a deployment variable fails safe instead of leaking diagnostics.
 */
function isHealthDebugEnabled(): boolean {
  return process.env.HEALTH_DEBUG === 'true'
}

interface DatabaseCheck {
  reachable: boolean
  mode: 'native'
  error?: string
}

async function checkDatabase(): Promise<DatabaseCheck> {
  const url = process.env.DATABASE_URL
  if (!url) return { reachable: false, mode: 'native', error: 'DATABASE_URL is not set' }
  try {
    await getPool().query({ text: 'select 1', query_timeout: 2000 } as { text: string; query_timeout: number } as never)
    return { reachable: true, mode: 'native' }
  } catch (err) {
    return { reachable: false, mode: 'native', error: err instanceof Error ? err.message : String(err) }
  }
}

export async function GET() {
  const db = await checkDatabase()
  // Auth is "configured" only when the required keys for the active backend exist.
  // ADMIN_EMAIL / ADMIN_PASSWORD are seed-only (see README), so they must NOT be
  // required here — a production native deployment would otherwise report
  // unhealthy (503) spuriously once the seed vars are removed.
  const authConfigured = secretProblem('AUTH_SECRET', process.env.AUTH_SECRET) === null

  const healthy = db.reachable && authConfigured
  const status = healthy ? 200 : 503
  const statusLabel = healthy ? 'ok' : 'degraded'

  const diagnostics = {
    version: process.env.APP_VERSION || process.env.npm_package_version || APP_VERSION,
    commit: process.env.GIT_COMMIT ?? null,
    backend: 'native' as const,
    pool: getPoolMetrics(),
    db,
    authConfigured,
  }

  // Always record the detail server-side, so removing it from the response does
  // not cost operators any diagnostic signal.
  if (!healthy) {
    logger.error('Readiness probe degraded', diagnostics)
  } else {
    logger.debug('Readiness probe ok', diagnostics)
  }

  if (isHealthDebugEnabled()) {
    return NextResponse.json({ status: statusLabel, ...diagnostics }, { status, headers: NO_STORE })
  }

  return NextResponse.json({ status: statusLabel }, { status, headers: NO_STORE })
}
