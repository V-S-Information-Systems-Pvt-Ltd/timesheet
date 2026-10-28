import 'server-only'

import { randomUUID } from 'node:crypto'
import { query, transaction } from '@/lib/db/pool'
import type { Actor } from '@/lib/db/types'
import type { HierarchyRole, PermissionRole, UserRole } from '@/app/types'

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
  /** profiles.session_version read when the credentials were verified. When
   * set, the session is only created if it is still current. */
  expectedSessionVersion?: number
}

export interface RotateMobileSessionInput {
  presentedTokenHash: string
  replacementTokenHash: string
  now?: Date
}

export type RotateMobileSessionResult =
  | { status: 'rotated'; session: MobileSession }
  | { status: 'invalid' | 'expired' | 'revoked' | 'reused' }

export type RevokeOtherSessionsResult = 'revoked' | 'conflict'

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

/** Returns null when `expectedSessionVersion` is set and no longer current:
 * a password reset or change committed after the credentials were verified. */
async function nativeCreate(input: CreateMobileSessionInput): Promise<MobileSession | null> {
  const now = input.now ?? new Date()
  const values = createValues(input, now, randomUUID(), randomUUID())
  const columns = `(id, user_id, family_id, refresh_token_hash, device_name, platform,
       created_at, last_used_at, idle_expires_at, absolute_expires_at)`
  if (input.expectedSessionVersion !== undefined) {
    // FOR SHARE waits for an in-flight password update to commit and then
    // re-checks the version, so the reset's revocation cannot be slipped past.
    const rows = await query<SessionRow>(
      `insert into public.mobile_sessions ${columns}
       select $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
              $7::timestamptz, $8::timestamptz, $9::timestamptz, $10::timestamptz
         from public.profiles
        where id = $2::uuid and session_version = $11
          for share
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
        input.expectedSessionVersion,
      ]
    )
    return rows[0] ? mapRow(rows[0]) : null
  }
  const rows = await query<SessionRow>(
    `insert into public.mobile_sessions ${columns}
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

interface SessionWithActorRow extends SessionRow {
  profile_id: string | null
  email: string | null
  role: UserRole | null
  permission_role: PermissionRole | null
  hierarchy_role: HierarchyRole | null
  is_active: boolean | null
  scope_departments: string[] | null
}

function mapActorFromJoined(row: {
  profile_id?: string | null
  email?: string | null
  role?: UserRole | null
  permission_role?: PermissionRole | null
  hierarchy_role?: HierarchyRole | null
  is_active?: boolean | null
  scope_departments?: string[] | null
}): Actor | null {
  if (!row.profile_id || !row.email || !row.permission_role || !row.hierarchy_role) {
    return null
  }
  return {
    id: row.profile_id,
    email: row.email,
    role: row.role ?? 'user',
    permission_role: row.permission_role,
    hierarchy_role: row.hierarchy_role,
    scope_departments: row.scope_departments ?? null,
    isActive: row.is_active ?? false,
  }
}

async function nativeFindSessionAndActorById(
  id: string
): Promise<{ session: MobileSession | null; actor: Actor | null }> {
  const rows = await query<SessionWithActorRow>(
    `select
       s.*,
       p.id as profile_id,
       p.email,
       p.role,
       p.permission_role,
       p.hierarchy_role,
       p.is_active,
       p.scope_departments
     from public.mobile_sessions s
     left join public.profiles p on p.id = s.user_id
     where s.id = $1
     limit 1`,
    [id]
  )
  const row = rows[0]
  if (!row) return { session: null, actor: null }
  return {
    session: mapRow(row),
    actor: mapActorFromJoined(row),
  }
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
    const idleTarget = new Date(now.getTime() + REFRESH_IDLE_SECONDS * 1000)
    const absoluteLimit = new Date(current.absolute_expires_at)
    const replacementIdleExpiresAt = new Date(Math.min(idleTarget.getTime(), absoluteLimit.getTime())).toISOString()

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
        replacementIdleExpiresAt,
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

async function nativeCleanupExpired(now: Date = new Date()): Promise<number> {
  const result = await query(
    `delete from public.mobile_sessions
     where (absolute_expires_at <= $1 or idle_expires_at <= $1 or (revoked_at is not null and revoked_at <= $1 - interval '7 days'))
     returning id`,
    [now.toISOString()]
  )
  return result.length
}

async function nativeRevokeOtherSessions(
  userId: string,
  preserveSessionId: string
): Promise<RevokeOtherSessionsResult> {
  await query(
    'update public.mobile_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = $1 and id <> $2 and revoked_at is null',
    [userId, preserveSessionId]
  )
  return 'revoked'
}

async function nativeBeginPasswordChange(userId: string): Promise<void> {
  await nativeRevokeAll(userId)
}


export const mobileSessionStore = {
  create: nativeCreate,
  findByHash: nativeFindByHash,
  findById: nativeFindById,
  findSessionAndActorById: nativeFindSessionAndActorById,
  rotate: nativeRotate,
  revokeSession: nativeRevokeSession,
  revokeAll: nativeRevokeAll,
  revokeOtherSessions: nativeRevokeOtherSessions,
  beginPasswordChange: nativeBeginPasswordChange,
  completePasswordChange: async (_userId: string, _preserveSessionId: string | null) => {},
  cleanupExpired: nativeCleanupExpired,
}
