// lib/db/write-gate.ts
// Server-side read of the C06B write gate for the application's write paths.
//
// The migration tooling owns the row (see migrations/tool/src/gate.ts and the
// migration_write_gate migrations); the application only obeys it. The read is
// cached briefly so a fence does not add a query to every request, and the
// cache direction is safe: the gate is closed before a freeze begins.
//
// Failure policy (C06B): a *missing* table means a deployment that never ran the
// migration, and an *unreachable* database means no mutation could commit
// through this process either — both resolve to "no gate". Any other read
// failure (permissions, schema) is surfaced, so the guards refuse writes rather
// than let them through during a genuine gate problem.
import 'server-only'

import { IS_NATIVE } from '@/lib/backend/config'

export interface AppWriteGate {
  state: 'open' | 'fenced'
  runId: string | null
  reason: string | null
}

const CACHE_MS = 5_000
let cached: { at: number; gate: AppWriteGate | null } | null = null

/** Failures that mean "this process cannot reach the database at all". */
const UNREACHABLE = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '57P01',
  '57P02',
  '57P03',
])

function isUnreachable(error: unknown): boolean {
  const code = (error as { code?: string }).code
  if (typeof code === 'string' && UNREACHABLE.has(code)) return true
  const message = error instanceof Error ? error.message : ''
  // Drivers and test doubles report connectivity problems in prose as often as
  // in SQLSTATE; match the ones that can only mean "no database here".
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo|connect ECONN|database .* does not exist|DATABASE_URL|POSTGRES_URL|pool|not configured|Missing .*environment/i.test(message)) {
    return true
  }
  // Next's cookie store only exists inside a request scope. Reaching this from a
  // unit test, a script or a cron job means the process cannot evaluate the
  // fence at all; a served request always has one, so this can never mask a real
  // fence in production.
  return /was called outside a request scope/i.test(message)
}

export function resetAppWriteGateCache(): void {
  cached = null
}

/** The gate as the application sees it, or null when the deployment has none. */
export async function readAppWriteGate(now: () => number = () => Date.now()): Promise<AppWriteGate | null> {
  if (cached && now() - cached.at < CACHE_MS) return cached.gate
  let gate: AppWriteGate | null = null
  try {
    gate = IS_NATIVE ? await readNativeGate() : await readSupabaseGate()
  } catch (error) {
    if ((error as { code?: string }).code === '42P01' || isUnreachable(error)) gate = null
    else throw error
  }
  cached = { at: now(), gate }
  return gate
}

async function readNativeGate(): Promise<AppWriteGate | null> {
  const { query } = await import('./pool')
  const rows = await query<{ state: string; run_id: string | null; reason: string | null }>(
    'select state, run_id, reason from public.migration_write_gate where id'
  )
  const row = rows[0]
  return row ? { state: row.state === 'fenced' ? 'fenced' : 'open', runId: row.run_id, reason: row.reason } : null
}

/**
 * The gate table belongs to the migration tooling, not to the application
 * schema, so it is deliberately absent from the generated database types. The
 * read is expressed against the narrow shape this module needs.
 */
interface GateQueryClient {
  from(table: string): {
    select(columns: string): {
      maybeSingle(): Promise<{ data: unknown; error: { code?: string; message: string } | null }>
    }
  }
}

async function readSupabaseGate(): Promise<AppWriteGate | null> {
  // Mobile API requests authenticate through the request-scoped bearer client,
  // not through the web cookie store used by createClient().
  const { getMobileSupabaseClient } = await import('@/lib/supabase/bearer')
  const mobileClient = getMobileSupabaseClient()
  let supabase: GateQueryClient
  if (mobileClient) {
    supabase = mobileClient as unknown as GateQueryClient
  } else {
    const { createClient } = await import('@/lib/supabase/server')
    supabase = (await createClient()) as unknown as GateQueryClient
  }
  return querySupabaseGate(supabase, true)
}

async function querySupabaseGate(
  supabase: GateQueryClient,
  allowMissingRelation: boolean
): Promise<AppWriteGate | null> {
  const { data, error } = await supabase
    .from('migration_write_gate')
    .select('state, run_id, reason')
    .maybeSingle()
  if (error) {
    // 42P01: the relation does not exist yet. PGRST205: PostgREST cannot see it
    // in its schema cache. Both mean an older deployment with no gate.
    if (allowMissingRelation && (error.code === '42P01' || error.code === 'PGRST205')) return null
    throw error
  }
  if (!data) return null
  const row = data as { state: string; run_id: string | null; reason: string | null }
  return { state: row.state === 'fenced' ? 'fenced' : 'open', runId: row.run_id, reason: row.reason }
}

/**
 * Fresh privileged gate read for scheduled maintenance.
 *
 * Cron runs outside an ordinary browser/mobile request, so its Supabase path
 * must not depend on request-scoped cookies or bearer state. It also bypasses
 * the application gate cache so a newly-fenced migration window immediately
 * stops scheduled writers. Missing/unreadable gate state is surfaced to the
 * caller so maintenance can fail closed.
 */
export async function readScheduledMaintenanceWriteGate(): Promise<AppWriteGate | null> {
  if (IS_NATIVE) return readNativeGate()

  const { getAdminClient } = await import('@/lib/supabase/admin')
  return querySupabaseGate(getAdminClient() as unknown as GateQueryClient, false)
}

/**
 * Refusal for a fenced deployment, or null when writes are admitted.
 * Read-only requests are never refused: the fence stops writes, not access.
 *
 * The message is defined here rather than imported from the migration tooling:
 * application code must not import it (see the boundary-enforcement suite), and
 * the migration CLI has its own wording for operators.
 */
export async function writeGateResponse(): Promise<{ status: number; body: unknown } | null> {
  const gate = await readAppWriteGate()
  if (gate?.state !== 'fenced') return null
  const suffix = gate.reason ? ` (${gate.reason})` : ''
  return {
    status: 503,
    body: {
      error: `This deployment is temporarily read-only for a data migration${suffix}. Your request was not applied; retry after the migration window.`,
      code: 'WRITERS_FENCED',
    },
  }
}
