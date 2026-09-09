import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Actor } from '@/lib/db/repository'

const { getTimesheet } = vi.hoisted(() => ({ getTimesheet: vi.fn() }))

vi.mock('@/lib/db', () => ({
  repo: { getTimesheet },
}))

import { reauthorizeBatchDuplicateStored } from '@/lib/api/v1/services/timesheets'

const adminUser: Actor = {
  id: 'admin-1',
  email: 'admin@x.com',
  role: 'admin',
  permission_role: 'admin',
  hierarchy_role: 'manager',
  isActive: true,
}

const regularUser: Actor = {
  id: 'user-1',
  email: 'user@x.com',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'user',
  isActive: true,
}

function storedPayload(results: Array<{ id: string; success: boolean }>) {
  return {
    data: { results, duplicatedCount: results.filter((r) => r.success).length },
    error: null,
  }
}

describe('batch-duplicate replay reauthorization (T19.2)', () => {
  beforeEach(() => {
    getTimesheet.mockReset()
  })

  it('rechecks every successful source entry before replaying', async () => {
    getTimesheet.mockImplementation(async (actor: Actor, id: string) => ({
      id,
      user_id: actor.id,
      log_date: '2026-08-28',
      hours_worked: 4,
    }))
    const result = await reauthorizeBatchDuplicateStored(
      regularUser,
      storedPayload([
        { id: 'a', success: true },
        { id: 'b', success: false },
        { id: 'other', success: true },
      ])
    )
    expect(result).toEqual({ ok: true })
    expect(getTimesheet.mock.calls.map((c) => c[1])).toEqual(['a', 'other'])
  })

  it('refuses the replay when a source entry is gone', async () => {
    getTimesheet.mockResolvedValue(null)
    const result = await reauthorizeBatchDuplicateStored(
      regularUser,
      storedPayload([{ id: 'gone', success: true }])
    )
    expect(result).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT', status: 409 })
  })

  it('refuses the replay when the actor lost access to a source entry', async () => {
    getTimesheet.mockResolvedValue({ id: 'stolen', user_id: 'someone-else', log_date: 'x', hours_worked: 2 })
    const result = await reauthorizeBatchDuplicateStored(
      regularUser,
      storedPayload([{ id: 'stolen', success: true }])
    )
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN', status: 403 })
  })

  it('admins may still replay entries owned by others', async () => {
    getTimesheet.mockResolvedValue({ id: 'target', user_id: 'someone-else', log_date: 'x', hours_worked: 2 })
    const result = await reauthorizeBatchDuplicateStored(
      adminUser,
      storedPayload([{ id: 'target', success: true }])
    )
    expect(result).toEqual({ ok: true })
  })

  it('an unrecognized stored payload is denied (fails closed, no replay)', async () => {
    const result = await reauthorizeBatchDuplicateStored(regularUser, { data: null, error: null })
    expect(result).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT', status: 409 })
    // Cannot re-verify access without a recognizable results array, so we must
    // not fetch entries or replay the stored DTOs.
    expect(getTimesheet).not.toHaveBeenCalled()
  })

  it('an absent stored payload is denied (fails closed, no replay)', async () => {
    const result = await reauthorizeBatchDuplicateStored(regularUser, undefined)
    expect(result).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT', status: 409 })
    expect(getTimesheet).not.toHaveBeenCalled()
  })

  it('a genuinely empty batch still replays (empty results array is recognized)', async () => {
    const result = await reauthorizeBatchDuplicateStored(regularUser, storedPayload([]))
    expect(result).toEqual({ ok: true })
    expect(getTimesheet).not.toHaveBeenCalled()
  })
})