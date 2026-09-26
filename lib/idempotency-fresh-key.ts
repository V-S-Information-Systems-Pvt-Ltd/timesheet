import 'server-only'

import { randomUUID } from 'node:crypto'
import { IS_NATIVE } from '@/lib/backend/config'
import { query } from '@/lib/db/pool'
import { getAdminClient } from '@/lib/supabase/admin'

export type FreshKeyOperation = 'create_reminder' | 'create_leave'
export interface FreshKeyTicket { key: string; expiresAt: string }

const LIFETIME_MS = 97 * 24 * 60 * 60 * 1000
const MAX_ISSUE_COUNT = 20

interface GateRow { state: string; fence_generation: string }
interface TicketRow { fence_generation: string; expires_at: string }

type AdminTable = {
  select(columns: string): {
    eq(column: string, value: string | boolean): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { maybeSingle(): Promise<{ data: TicketRow | null; error: { message: string } | null }> }
      }
      maybeSingle(): Promise<{ data: GateRow | null; error: { message: string } | null }>
    }
  }
  insert(rows: Array<Record<string, unknown>>): Promise<{ error: { message: string } | null }>
}

function adminTable(name: string): AdminTable {
  return (getAdminClient() as unknown as { from(table: string): AdminTable }).from(name)
}

async function currentGate(): Promise<GateRow | null> {
  if (IS_NATIVE) {
    const rows = await query<GateRow>(
      'select state, fence_generation::text as fence_generation from public.migration_write_gate where id'
    )
    return rows[0] ?? null
  }
  const { data, error } = await adminTable('migration_write_gate')
    .select('state,fence_generation').eq('id', true).maybeSingle()
  if (error) throw new Error(`Fresh-key gate lookup failed: ${error.message}`)
  return data
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
  if (IS_NATIVE) {
    const values = rows.map((_, i) =>
      `($${i * 5 + 1}, $${i * 5 + 2}::uuid, $${i * 5 + 3}, $${i * 5 + 4}::uuid, $${i * 5 + 5}::timestamptz)`
    ).join(', ')
    await query(
      `insert into public.migration_fresh_keys
         (key, actor_id, operation, fence_generation, expires_at) values ${values}`,
      rows.flatMap((row) => [row.key, row.actor_id, row.operation, row.fence_generation, row.expires_at])
    )
  } else {
    const { error } = await adminTable('migration_fresh_keys').insert(rows)
    if (error) throw new Error(`Fresh-key issuance failed: ${error.message}`)
  }
  // A concurrent fence can only make these old-generation keys unusable. The
  // execution check below always compares against the current durable row.
  return tickets
}

/** Verify actor, operation, expiry and live destination generation. */
export async function admitsFreshKey(key: string, actorId: string, operation: FreshKeyOperation): Promise<boolean> {
  if (!/^mf_[0-9a-f-]{36}$/.test(key)) return false
  if (IS_NATIVE) {
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
  const { data: ticket, error } = await adminTable('migration_fresh_keys')
    .select('fence_generation,expires_at')
    .eq('key', key).eq('actor_id', actorId).eq('operation', operation).maybeSingle()
  if (error) throw new Error(`Fresh-key lookup failed: ${error.message}`)
  if (!ticket || Date.parse(ticket.expires_at) <= Date.now()) return false
  const gate = await currentGate()
  return gate?.state === 'open' && gate.fence_generation === ticket.fence_generation
}

/** Best-effort retention cleanup; expired tickets can never authorize new work. */
export async function cleanupExpiredFreshKeys(): Promise<void> {
  if (IS_NATIVE) {
    await query('delete from public.migration_fresh_keys where expires_at <= now()')
    return
  }
  const admin = getAdminClient() as unknown as {
    from(table: string): {
      delete(): { lte(column: string, value: string): Promise<{ error: { message: string } | null }> }
    }
  }
  const { error } = await admin.from('migration_fresh_keys').delete()
    .lte('expires_at', new Date().toISOString())
  if (error) throw new Error(`Fresh-key cleanup failed: ${error.message}`)
}
