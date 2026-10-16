import 'server-only'

import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db/pool'

export type FreshKeyOperation = 'create_reminder' | 'create_leave'
export interface FreshKeyTicket { key: string; expiresAt: string }

const LIFETIME_MS = 97 * 24 * 60 * 60 * 1000
const MAX_ISSUE_COUNT = 20

interface GateRow { state: string; fence_generation: string }
async function currentGate(): Promise<GateRow | null> {
  const rows = await query<GateRow>(
    'select state, fence_generation::text as fence_generation from public.migration_write_gate where id'
  )
  return rows[0] ?? null
}

/** Mint only new, server-owned keys; the caller cannot submit a legacy key to be blessed. */
export async function issueFreshKeys(
  actorId: string,
  operation: FreshKeyOperation,
  count: number
): Promise<FreshKeyTicket[] | null> {
  if (!['create_reminder', 'create_leave'].includes(operation) ||
      !Number.isInteger(count) || count < 1 || count > MAX_ISSUE_COUNT) {
    throw new Error('Invalid fresh-key issuance request.')
  }
  const gate = await currentGate()
  if (!gate || gate.state !== 'open' || !gate.fence_generation) return null

  const expiresAt = new Date(Date.now() + LIFETIME_MS).toISOString()
  const tickets = Array.from({ length: count }, () => ({ key: `mf_${randomUUID()}`, expiresAt }))
  const rows = tickets.map((ticket) => ({
    key: ticket.key, actor_id: actorId, operation,
    fence_generation: gate.fence_generation, expires_at: ticket.expiresAt,
  }))
  {
    const values = rows.map((_, i) =>
      `($${i * 5 + 1}, $${i * 5 + 2}::uuid, $${i * 5 + 3}, $${i * 5 + 4}::uuid, $${i * 5 + 5}::timestamptz)`
    ).join(', ')
    await query(
      `insert into public.migration_fresh_keys
         (key, actor_id, operation, fence_generation, expires_at) values ${values}`,
      rows.flatMap((row) => [row.key, row.actor_id, row.operation, row.fence_generation, row.expires_at])
    )
  }
  // A concurrent fence can only make these old-generation keys unusable. The
  // execution check below always compares against the current durable row.
  return tickets
}

/** Verify actor, operation, expiry and live destination generation. */
export async function admitsFreshKey(key: string, actorId: string, operation: FreshKeyOperation): Promise<boolean> {
  if (!/^mf_[0-9a-f-]{36}$/.test(key)) return false
  const rows = await query<{ admitted: boolean }>(
    `select true as admitted
       from public.migration_fresh_keys ticket
       join public.migration_write_gate gate
         on gate.id and gate.state = 'open'
        and gate.fence_generation = ticket.fence_generation
      where ticket.key = $1 and ticket.actor_id = $2::uuid
        and ticket.operation = $3 and ticket.expires_at > now()`,
    [key, actorId, operation]
  )
  return rows.length === 1
}

/** Best-effort retention cleanup; expired tickets can never authorize new work. */
export async function cleanupExpiredFreshKeys(): Promise<void> {
  await query('delete from public.migration_fresh_keys where expires_at <= now()')
}
