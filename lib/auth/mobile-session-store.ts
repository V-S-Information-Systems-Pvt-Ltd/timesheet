import 'server-only'

import { randomUUID } from 'node:crypto'
import { IS_NATIVE } from '@/lib/backend'
import { getAdminClient } from '@/lib/supabase/admin'
import { query, transaction } from '@/lib/db/pool'

export const REFRESH_IDLE_SECONDS = 30 * 24 * 60 * 60
export const REFRESH_ABSOLUTE_SECONDS = 90 * 24 * 60 * 60

export interface MobileSession {
  id: string
  userId: string
  familyId: string
  refreshTokenHash: string
  previousTokenHash: string | null
  deviceName: string
  platform: string
  createdAt: string
  lastUsedAt: string
  idleExpiresAt: string
  absoluteExpiresAt: string
  rotatedAt: string | null
  revokedAt: string | null
  replacedById: string | null
}

export interface CreateMobileSessionInput {
  userId: string
  refreshTokenHash: string
  deviceName?: string
  platform?: string
  now?: Date
}

export interface RotateMobileSessionInput {
  presentedTokenHash: string
  replacementTokenHash: string
  now?: Date
}

export type RotateMobileSessionResult =
  | { status: 'rotated'; session: MobileSession }
  | { status: 'invalid' | 'expired' | 'revoked' | 'reused' }

interface SessionRow {
  id: string
  user_id: string
  family_id: string
  refresh_token_hash: string
  previous_token_hash: string | null
  device_name: string
  platform: string
  created_at: string
  last_used_at: string
  idle_expires_at: string
  absolute_expires_at: string
  rotated_at: string | null
  revoked_at: string | null
  replaced_by_id: string | null
}

function mapRow(row: SessionRow): MobileSession {
  return {
    id: row.id,
    userId: row.user_id,
    familyId: row.family_id,
    refreshTokenHash: row.refresh_token_hash,
    previousTokenHash: row.previous_token_hash,
    deviceName: row.device_name,
    platform: row.platform,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    rotatedAt: row.rotated_at,
    revokedAt: row.revoked_at,
    replacedById: row.replaced_by_id,
  }
}

function mapRpcRow(row: Record<string, unknown>): MobileSession {
  return mapRow({
    id: String(row.session_id),
    user_id: String(row.user_id),
    family_id: String(row.family_id),
    refresh_token_hash: String(row.refresh_token_hash),
    previous_token_hash: (row.previous_token_hash as string | null) ?? null,
    device_name: String(row.device_name ?? ''),
    platform: String(row.platform ?? 'unknown'),
    created_at: String(row.created_at),
    last_used_at: String(row.last_used_at),
    idle_expires_at: String(row.idle_expires_at),
    absolute_expires_at: String(row.absolute_expires_at),
    rotated_at: (row.rotated_at as string | null) ?? null,
    revoked_at: (row.revoked_at as string | null) ?? null,
    replaced_by_id: (row.replaced_by_id as string | null) ?? null,
  })
}

function expiry(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString()
}

function createValues(input: CreateMobileSessionInput, now: Date, familyId: string, id: string) {
  return {
    id,
    user_id: input.userId,
    family_id: familyId,
    refresh_token_hash: input.refreshTokenHash,
    device_name: (input.deviceName ?? '').slice(0, 120),
    platform: (input.platform ?? 'unknown').slice(0, 32),
    created_at: now.toISOString(),
    last_used_at: now.toISOString(),
    idle_expires_at: expiry(now, REFRESH_IDLE_SECONDS),
    absolute_expires_at: expiry(now, REFRESH_ABSOLUTE_SECONDS),
  }
}

async function nativeCreate(input: CreateMobileSessionInput): Promise<MobileSession> {
  const now = input.now ?? new Date()
  const values = createValues(input, now, randomUUID(), randomUUID())
  const rows = await query<SessionRow>(
    `insert into public.mobile_sessions
      (id, user_id, family_id, refresh_token_hash, device_name, platform,
       created_at, last_used_at, idle_expires_at, absolute_expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning *`,
    [
      values.id,
      values.user_id,
      values.family_id,
      values.refresh_token_hash,
      values.device_name,
      values.platform,
      values.created_at,
      values.last_used_at,
      values.idle_expires_at,
      values.absolute_expires_at,
    ]
  )
  if (!rows[0]) throw new Error('Failed to create mobile session.')
  return mapRow(rows[0])
}

async function nativeFindByHash(hash: string): Promise<MobileSession | null> {
  const rows = await query<SessionRow>(
    'select * from public.mobile_sessions where refresh_token_hash = $1 limit 1',
    [hash]
  )
  return rows[0] ? mapRow(rows[0]) : null
}

async function nativeFindById(id: string): Promise<MobileSession | null> {
  const rows = await query<SessionRow>('select * from public.mobile_sessions where id = $1 limit 1', [id])
  return rows[0] ? mapRow(rows[0]) : null
}

async function nativeRotate(input: RotateMobileSessionInput): Promise<RotateMobileSessionResult> {
  const now = input.now ?? new Date()
  return transaction(async (client) => {
    const currentResult = await client.query<SessionRow>(
      'select * from public.mobile_sessions where refresh_token_hash = $1 for update',
      [input.presentedTokenHash]
    )
    let current = currentResult.rows[0]

    if (!current) {
      const previousResult = await client.query<SessionRow>(
        'select * from public.mobile_sessions where previous_token_hash = $1 for update',
        [input.presentedTokenHash]
      )
      current = previousResult.rows[0]
      if (current) {
        await client.query(
          'update public.mobile_sessions set revoked_at = coalesce(revoked_at, $1) where family_id = $2 and revoked_at is null',
          [now.toISOString(), current.family_id]
        )
        return { status: 'reused' as const }
      }
      return { status: 'invalid' as const }
    }

    const nowMs = now.getTime()
    if (current.rotated_at) {
      await client.query(
        'update public.mobile_sessions set revoked_at = coalesce(revoked_at, $1) where family_id = $2 and revoked_at is null',
        [now.toISOString(), current.family_id]
      )
      return { status: 'reused' as const }
    }
    if (current.revoked_at) return { status: 'revoked' as const }
    if (
      new Date(current.idle_expires_at).getTime() <= nowMs ||
      new Date(current.absolute_expires_at).getTime() <= nowMs
    ) {
      await client.query('update public.mobile_sessions set revoked_at = $1 where id = $2', [now.toISOString(), current.id])
      return { status: 'expired' as const }
    }

    const replacementId = randomUUID()
    const replacement = await client.query<SessionRow>(
      `insert into public.mobile_sessions
        (id, user_id, family_id, refresh_token_hash, previous_token_hash,
         device_name, platform, created_at, last_used_at, idle_expires_at,
         absolute_expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10)
       returning *`,
      [
        replacementId,
        current.user_id,
        current.family_id,
        input.replacementTokenHash,
        current.refresh_token_hash,
        current.device_name,
        current.platform,
        now.toISOString(),
        expiry(now, REFRESH_IDLE_SECONDS),
        current.absolute_expires_at,
      ]
    )
    await client.query(
      'update public.mobile_sessions set rotated_at = $1, last_used_at = $1, replaced_by_id = $2 where id = $3',
      [now.toISOString(), replacementId, current.id]
    )
    return replacement.rows[0]
      ? { status: 'rotated' as const, session: mapRow(replacement.rows[0]) }
      : { status: 'invalid' as const }
  })
}

async function nativeRevokeSession(id: string): Promise<void> {
  await query('update public.mobile_sessions set revoked_at = coalesce(revoked_at, now()) where id = $1', [id])
}

async function nativeRevokeAll(userId: string): Promise<void> {
  await query(
    'update public.mobile_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = $1 and revoked_at is null',
    [userId]
  )
}

type SupabaseTableClient = {
  from(table: string): {
    insert(values: Record<string, unknown>): { select(columns: string): { single(): Promise<{ data: SessionRow | null; error: { message: string } | null }> } }
    select(columns: string): {
      eq(column: string, value: string): { maybeSingle(): Promise<{ data: SessionRow | null; error: { message: string } | null }> }
    }
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): { select(columns: string): Promise<{ data: SessionRow[] | null; error: { message: string } | null }> }
    }
  }
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>
}

function supabaseClient(): SupabaseTableClient {
  return getAdminClient() as unknown as SupabaseTableClient
}

async function supabaseCreate(input: CreateMobileSessionInput): Promise<MobileSession> {
  const now = input.now ?? new Date()
  const values = createValues(input, now, randomUUID(), randomUUID())
  const { data, error } = await supabaseClient().from('mobile_sessions').insert(values).select('*').single()
  if (error || !data) throw new Error(error?.message ?? 'Failed to create mobile session.')
  return mapRow(data)
}

async function supabaseFindByHash(hash: string): Promise<MobileSession | null> {
  const { data, error } = await supabaseClient()
    .from('mobile_sessions')
    .select('*')
    .eq('refresh_token_hash', hash)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapRow(data) : null
}

async function supabaseFindById(id: string): Promise<MobileSession | null> {
  const { data, error } = await supabaseClient()
    .from('mobile_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapRow(data) : null
}

async function supabaseRotate(input: RotateMobileSessionInput): Promise<RotateMobileSessionResult> {
  const now = input.now ?? new Date()
  const { data, error } = await supabaseClient().rpc('rotate_mobile_session', {
    p_presented_token_hash: input.presentedTokenHash,
    p_replacement_token_hash: input.replacementTokenHash,
    p_now: now.toISOString(),
  })
  if (error) throw new Error(error.message)
  const result = data?.[0]
  if (!result || typeof result.status !== 'string') return { status: 'invalid' }
  if (result.status === 'invalid' || result.status === 'expired' || result.status === 'revoked' || result.status === 'reused') {
    return { status: result.status }
  }
  if (result.status !== 'rotated') return { status: 'invalid' }
  return {
    status: 'rotated',
    session: mapRpcRow(result),
  }
}

async function supabaseRevokeSession(id: string): Promise<void> {
  const { error } = await supabaseClient()
    .from('mobile_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw new Error(error.message)
}

async function supabaseRevokeAll(userId: string): Promise<void> {
  const { error } = await supabaseClient()
    .from('mobile_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('id')
  if (error) throw new Error(error.message)
}

export const mobileSessionStore = IS_NATIVE
  ? {
      create: nativeCreate,
      findByHash: nativeFindByHash,
      findById: nativeFindById,
      rotate: nativeRotate,
      revokeSession: nativeRevokeSession,
      revokeAll: nativeRevokeAll,
    }
  : {
      create: supabaseCreate,
      findByHash: supabaseFindByHash,
      findById: supabaseFindById,
      rotate: supabaseRotate,
      revokeSession: supabaseRevokeSession,
      revokeAll: supabaseRevokeAll,
    }
