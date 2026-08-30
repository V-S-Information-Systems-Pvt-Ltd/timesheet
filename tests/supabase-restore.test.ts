// tests/supabase-restore.test.ts
// Focused tests for the Supabase restoreBackup "merge" semantics: duplicate
// leaves must be skipped (idempotent re-restore), NOT abort the whole restore.
// The supabase repository talks to PostgREST, so the admin client is stubbed
// with a scripted query builder.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { getAdminClient } from '@/lib/supabase/admin'
import { supabaseRepository } from '@/lib/db/supabase'
import type { BackupPayload } from '@/app/types'

/** Minimal fake PostgREST builder: records the call chain and resolves the
 * next canned result for its table (or a harmless empty payload). */
class FakeBuilder {
  static pending = new Map<string, Array<() => { data: unknown; error: unknown }>>()
  ops: string[] = []

  constructor(private table: string) {}

  select() {
    this.ops.push('select')
    return this
  }
  insert(..._args: unknown[]) {
    this.ops.push('insert')
    return this
  }
  limit() {
    this.ops.push('limit')
    return this
  }
  range() {
    this.ops.push('range')
    return this
  }
  order() {
    this.ops.push('order')
    return this
  }
  eq() {
    this.ops.push('eq')
    return this
  }
  in() {
    this.ops.push('in')
    return this
  }
  single() {
    this.ops.push('single')
    return this
  }
  then(resolve: (v: unknown) => void) {
    const queue = FakeBuilder.pending.get(this.table) ?? []
    const next = queue.shift()
    const result = next ? next() : { data: [], error: null }
    return Promise.resolve(result).then(resolve)
  }
}

const admin = {
  from: (table: string) => new FakeBuilder(table as string),
}

const adminActor = { id: 'a1', email: 'admin@x.com', role: 'admin' as const, permission_role: 'admin' as const, hierarchy_role: 'user' as const, isActive: true }

/** A minimal but valid backup payload. */
const payload = (): BackupPayload => ({
  version: 1,
  exportedAt: '2026-08-20T00:00:00.000Z',
  projects: [],
  activityTypes: [],
  timesheets: [],
  leaves: [{ email: 'a@x.com', leave_date: '2026-08-20', reason: 'sick' }],
  reminders: [],
  globalReminders: [],
})

/** Seed scripted responses for every table the restore touches. */
const seedDefaults = () => {
  FakeBuilder.pending.set('projects', [() => ({ data: [], error: null })])
  FakeBuilder.pending.set('activity_types', [() => ({ data: [], error: null })])
  FakeBuilder.pending.set('profiles', [() => ({ data: [{ id: 'u1', email: 'a@x.com' }], error: null })])
  FakeBuilder.pending.set('timesheets', [() => ({ data: [], error: null })])
  FakeBuilder.pending.set('reminders', [() => ({ data: [], error: null })])
  FakeBuilder.pending.set('global_reminders', [() => ({ data: [], error: null })])
}

beforeEach(() => {
    vi.mocked(getAdminClient).mockReturnValue(admin as never)
    FakeBuilder.pending.clear()
    seedDefaults()
    // Default: no existing leaves and no concurrent conflict on insert.
    FakeBuilder.pending.set('leaves', [
      () => ({ data: [], error: null }),
      () => ({ data: [{ id: 'leaf-1' }], error: null }),
    ])
  })

describe('supabase restoreBackup leaves merge', () => {
  it('skips a leave that already exists (pre-loaded key) and completes the restore', async () => {
    // A second restore of the same backup: the leave is already in the DB.
    FakeBuilder.pending.set('leaves', [
      () => ({ data: [{ user_id: 'u1', leave_date: '2026-08-20' }], error: null }),
      () => ({ data: [{ id: 'leaf-1' }], error: null }),
    ])
    const result = await supabaseRepository.restoreBackup(adminActor, payload())
    expect(result.error).toBeNull()
    expect(result.created.leaves).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('treats a 23505 unique violation on a leave as a skip, not a failure', async () => {
    FakeBuilder.pending.set('leaves', [
      () => ({ data: [], error: null }),
      () => ({ data: null, error: { code: '23505', message: 'duplicate leave', details: '', hint: '' } }),
    ])
    const result = await supabaseRepository.restoreBackup(adminActor, payload())
    expect(result.error).toBeNull()
    expect(result.created.leaves).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('counts a newly inserted leave as created when there is no conflict', async () => {
    const result = await supabaseRepository.restoreBackup(adminActor, payload())
    expect(result.error).toBeNull()
    expect(result.created.leaves).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('still aborts on unrelated errors instead of swallowing them', async () => {
    FakeBuilder.pending.set('leaves', [
      () => ({ data: [], error: null }),
      () => ({ data: null, error: { code: 'PGRST116', message: 'relation does not exist', details: '', hint: '' } }),
    ])
    const result = await supabaseRepository.restoreBackup(adminActor, payload())
    expect(result.created.leaves).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.error).toContain('relation does not exist')
  })

  it('skips leaves whose user email is unknown', async () => {
    const backup = payload()
    backup.leaves[0].email = 'missing@x.com'
    const result = await supabaseRepository.restoreBackup(adminActor, backup)
    expect(result.error).toBeNull()
    expect(result.created.leaves).toBe(0)
    expect(result.skipped).toBe(1)
  })
})