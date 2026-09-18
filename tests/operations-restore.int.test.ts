// tests/operations-restore.int.test.ts
// Live PostgreSQL test proving the operations coordinator preserves restore
// atomicity: the whole provider restore is one transaction, so a validation
// failure never reaches the provider and a mid-write failure rolls back with no
// committed counts. Runs only when TEST_DATABASE_URL is set (same harness
// convention as tests/restore.int.test.ts).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { Pool } from 'pg'
import { nativeRepository } from '@/lib/db/native'
import { restoreBackupFromJson, type OperationsDomainDeps } from '@/lib/domain/operations'
import type { BackupPayload } from '@/app/types'

vi.mock('@/lib/backend/config', () => ({
  IS_NATIVE: true,
  IS_SUPABASE: false,
  BACKEND: 'native',
}))

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

const admin = {
  id: 'restore-admin',
  email: 'restore.admin@example.com',
  role: 'admin' as const,
  permission_role: 'admin' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

/** Composition mirroring lib/db/operations.ts but pinned to the native adapter. */
function nativeDeps(): OperationsDomainDeps {
  return {
    persistence: {
      exportBackup: (actor) => nativeRepository.exportBackup(actor),
      restoreBackup: (actor, payload) => nativeRepository.restoreBackup(actor, payload),
      importTimesheets: (actor, rows) => nativeRepository.importTimesheets(actor, rows),
      deleteUserTimesheets: (actor, userId) => nativeRepository.deleteUserTimesheets(actor, userId),
      resetTimesheets: (actor) => nativeRepository.resetTimesheets(actor),
      resetActivityData: (actor) => nativeRepository.resetActivityData(actor),
      resetAllData: (actor) => nativeRepository.resetAllData(actor),
      writeAuditLog: (actor, entry) => nativeRepository.writeAuditLog(actor, entry),
    },
    maintenance: {
      cleanupExpiredSessions: async () => 0,
      cleanupRateLimits: (before) => nativeRepository.cleanupRateLimits(before),
      cleanupIdempotencyKeys: async () => 0,
    },
    clock: () => new Date('2026-01-01T00:00:00.000Z'),
    backend: 'native',
  }
}

function payload(overrides: Partial<BackupPayload> = {}): BackupPayload {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    projects: [],
    activityTypes: [],
    timesheets: [],
    leaves: [],
    reminders: [],
    globalReminders: [],
    ...overrides,
  }
}

suite('operations coordinator restore atomicity (live Postgres)', () => {
  const pool = new Pool({ connectionString: url })
  let userId: string

  beforeAll(async () => {
    if (url) process.env.DATABASE_URL = url
    const userRes = await pool.query<{ id: string }>(
      `insert into public.profiles (email, name, role, is_active)
       values ('ops.restore.user@example.com', 'Ops Restore User', 'user', true)
       on conflict (email) do update set is_active = true
       returning id`
    )
    userId = userRes.rows[0].id
  })

  afterAll(async () => {
    await pool.query(`delete from public.timesheets where user_id = $1`, [userId])
    await pool.query(`delete from public.leaves where user_id = $1`, [userId])
    await pool.query(`delete from public.reminders where user_id = $1`, [userId])
    await pool.query(`delete from public.projects where name like 'OpsRestoreProj-%'`)
    await pool.query(`delete from public.profiles where id = $1`, [userId])
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query(`delete from public.timesheets where user_id = $1`, [userId])
    await pool.query(`delete from public.leaves where user_id = $1`, [userId])
    await pool.query(`delete from public.reminders where user_id = $1`, [userId])
    await pool.query(`delete from public.projects where name like 'OpsRestoreProj-%'`)
  })

  it('commits a valid restore and reports the real created counts', async () => {
    const stamp = Date.now()
    const outcome = await restoreBackupFromJson(
      admin,
      JSON.stringify(
        payload({
          projects: [{ name: `OpsRestoreProj-${stamp}`, so_number: null, telegram_no: null }],
          leaves: [{ email: 'ops.restore.user@example.com', leave_date: '2099-03-01', reason: 'ok' }],
        })
      ),
      nativeDeps()
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.data.created.projects).toBe(1)
    expect(outcome.data.created.leaves).toBe(1)

    const projects = await pool.query(`select id from public.projects where name = $1`, [
      `OpsRestoreProj-${stamp}`,
    ])
    expect(projects.rows).toHaveLength(1)
    const leaves = await pool.query(`select id from public.leaves where user_id = $1`, [userId])
    expect(leaves.rows).toHaveLength(1)
  })

  it('does not touch the provider on a validation failure (no partial state)', async () => {
    const stamp = Date.now()
    const outcome = await restoreBackupFromJson(
      admin,
      JSON.stringify(
        payload({
          projects: [{ name: `OpsRestoreProj-${stamp}`, so_number: null, telegram_no: null }],
        })
      ),
      nativeDeps()
    )
    expect(outcome.ok).toBe(true) // baseline sanity for the name used below

    const invalid = await restoreBackupFromJson(
      admin,
      JSON.stringify({ ...payload(), version: 99 }),
      nativeDeps()
    )
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.code).toBe('VALIDATION_ERROR')

    const rows = await pool.query(`select id from public.projects where name like 'OpsRestoreProj-%'`)
    expect(rows.rows).toHaveLength(1) // only the baseline row; the invalid restore wrote nothing
  })

  it('rolls back a late-category failure and reports zeroed counts', async () => {
    const stamp = Date.now()
    const before = await pool.query<{ c: string }>(
      `select count(*)::text as c from public.projects where name like 'OpsRestoreProj-%'`
    )

    const outcome = await restoreBackupFromJson(
      admin,
      JSON.stringify(
        payload({
          projects: [{ name: `OpsRestoreProj-${stamp}`, so_number: null, telegram_no: null }],
          leaves: [{ email: 'ops.restore.user@example.com', leave_date: '2099-02-01', reason: 'ok' }],
          reminders: [
            {
              email: 'ops.restore.user@example.com',
              message: 'ok',
              // parseBackup only checks that remind_at is present; the late
              // reminder insert then fails on the timestamptz cast.
              remind_at: 'not-a-timestamp',
              done: false,
            },
          ],
        })
      ),
      nativeDeps()
    )

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error.code).toBe('STORAGE_ERROR')
    expect('data' in outcome).toBe(false)

    const afterProjects = await pool.query<{ c: string }>(
      `select count(*)::text as c from public.projects where name like 'OpsRestoreProj-%'`
    )
    expect(afterProjects.rows[0].c).toBe(before.rows[0].c)
    const leaves = await pool.query(`select id from public.leaves where user_id = $1`, [userId])
    expect(leaves.rows).toHaveLength(0)
  })
})
