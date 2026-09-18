// tests/leave-reminders-domain.test.ts
// Focused coverage for the leave/reminders application module: validation,
// authorization, write-budget charge/release, and reminder state transitions.
import { describe, expect, it, vi } from 'vitest'
import type { Actor } from '@/lib/db/repository'
import type { LeaveReminderPersistence } from '@/lib/domain/leave-reminders-port'
import type { WriteBudget } from '@/lib/domain/write-budget'
import {
  createGlobalReminder,
  createLeaves,
  createReminder,
  deleteLeave,
  dismissGlobalReminder,
  listLeaves,
  updateReminder,
} from '@/lib/domain/leave-reminders'

const actor: Actor = {
  id: 'u1',
  email: 'u@example.com',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'user',
  isActive: true,
}

const inactive: Actor = { ...actor, isActive: false }

function makePersistence(overrides: Partial<LeaveReminderPersistence> = {}): LeaveReminderPersistence {
  return {
    listLeaves: vi.fn().mockResolvedValue([]),
    createLeaves: vi.fn().mockResolvedValue({ error: null }),
    deleteLeave: vi.fn().mockResolvedValue({ error: null }),
    listReminders: vi.fn().mockResolvedValue([]),
    createReminder: vi.fn().mockResolvedValue({ error: null }),
    updateReminder: vi.fn().mockResolvedValue({ error: null }),
    deleteReminder: vi.fn().mockResolvedValue({ error: null }),
    listGlobalReminders: vi.fn().mockResolvedValue([]),
    listDueGlobalReminders: vi.fn().mockResolvedValue([]),
    createGlobalReminder: vi.fn().mockResolvedValue({
      data: { id: 'gr1', message: 'm', remind_at: '2026-01-01T00:00:00.000Z' },
      error: null,
    }),
    updateGlobalReminder: vi.fn().mockResolvedValue({ error: null }),
    deleteGlobalReminder: vi.fn().mockResolvedValue({ error: null }),
    dismissGlobalReminder: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  }
}

function makeBudget(reserved = true) {
  const release = vi.fn().mockResolvedValue(undefined)
  const reserve = vi.fn().mockResolvedValue(
    reserved
      ? { ok: true, reservation: { release } }
      : { ok: false, error: 'Rate limit exceeded. Try again in 5s.' }
  )
  const budget: WriteBudget = { reserve }
  return { budget, reserve, release }
}

describe('leave/reminders domain: leaves', () => {
  it('validates the leave list query before hitting persistence', async () => {
    const persistence = makePersistence()
    const { budget } = makeBudget()
    const result = await listLeaves(actor, { from: 'not-a-date' }, { persistence, writeBudget: budget })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR')
    expect(persistence.listLeaves).not.toHaveBeenCalled()
  })

  it('lists leaves for a valid query', async () => {
    const rows = [{ id: 'l1' }] as never[]
    const persistence = makePersistence({ listLeaves: vi.fn().mockResolvedValue(rows) })
    const { budget } = makeBudget()
    const result = await listLeaves(actor, { from: '2026-01-01', to: '2026-01-31' }, { persistence, writeBudget: budget })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBe(rows)
    expect(persistence.listLeaves).toHaveBeenCalledWith(actor, { from: '2026-01-01', to: '2026-01-31' })
    // Reads never charge the write budget.
    expect(budget.reserve).not.toHaveBeenCalled()
  })

  it('creates validated leave rows and keeps the reserved slot', async () => {
    const persistence = makePersistence()
    const { budget, release } = makeBudget()
    const rows = [{ userId: 'u1', leaveDate: '2026-01-04', reason: 'vacation' }]
    const result = await createLeaves(actor, rows, { persistence, writeBudget: budget })
    expect(result.ok).toBe(true)
    expect(persistence.createLeaves).toHaveBeenCalledWith(actor, rows)
    expect(release).not.toHaveBeenCalled()
  })

  it('releases the reserved slot and skips persistence on invalid rows', async () => {
    const persistence = makePersistence()
    const { budget, release } = makeBudget()
    const result = await createLeaves(actor, [{ userId: 'u1', leaveDate: 'tomorrow' }], {
      persistence,
      writeBudget: budget,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR')
    expect(persistence.createLeaves).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('returns RATE_LIMITED without reaching persistence when the budget is exhausted', async () => {
    const persistence = makePersistence()
    const { budget } = makeBudget(false)
    const result = await createLeaves(actor, [{ userId: 'u1', leaveDate: '2026-01-04', reason: '' }], {
      persistence,
      writeBudget: budget,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('RATE_LIMITED')
    expect(persistence.createLeaves).not.toHaveBeenCalled()
  })

  it('maps a storage failure and releases the slot', async () => {
    const persistence = makePersistence({
      deleteLeave: vi.fn().mockResolvedValue({ error: 'db down' }),
    })
    const { budget, release } = makeBudget()
    const result = await deleteLeave(actor, 'l1', { persistence, writeBudget: budget })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR')
      expect(result.error.message).toBe('db down')
    }
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('denies inactive actors before touching persistence or the budget', async () => {
    const persistence = makePersistence()
    const { budget } = makeBudget()
    const result = await createLeaves(inactive, [{ userId: 'u1', leaveDate: '2026-01-04', reason: '' }], {
      persistence,
      writeBudget: budget,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
    expect(persistence.createLeaves).not.toHaveBeenCalled()
    expect(budget.reserve).not.toHaveBeenCalled()
  })
})

describe('leave/reminders domain: reminders', () => {
  it('normalizes remindAt to ISO and scopes the reminder to the actor', async () => {
    const persistence = makePersistence()
    const { budget } = makeBudget()
    const result = await createReminder(
      actor,
      { message: '  hello  ', remindAt: '2026-01-01T10:00' },
      { persistence, writeBudget: budget }
    )
    expect(result.ok).toBe(true)
    expect(persistence.createReminder).toHaveBeenCalledWith(actor, {
      userId: 'u1',
      message: 'hello',
      remindAt: new Date('2026-01-01T10:00').toISOString(),
    })
  })

  it('rejects a malformed reminder time with a validation error', async () => {
    const persistence = makePersistence()
    const { budget } = makeBudget()
    const result = await createReminder(actor, { message: 'm', remindAt: 'not-a-date' }, {
      persistence,
      writeBudget: budget,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/Invalid reminder time/)
    expect(persistence.createReminder).not.toHaveBeenCalled()
  })

  it('coerces the done flag and charges exactly once', async () => {
    const persistence = makePersistence()
    const { budget, reserve } = makeBudget()
    const result = await updateReminder(actor, 'r1', { done: true }, { persistence, writeBudget: budget })
    expect(result.ok).toBe(true)
    expect(persistence.updateReminder).toHaveBeenCalledWith(actor, 'r1', { done: true })
    expect(reserve).toHaveBeenCalledTimes(1)
  })
})

describe('leave/reminders domain: global reminders', () => {
  it('validates and creates a global reminder without charging the write budget', async () => {
    const persistence = makePersistence()
    const { budget, reserve } = makeBudget()
    const result = await createGlobalReminder(
      actor,
      { message: 'Town hall', remindAt: '2026-09-01T16:00:00.000Z' },
      { persistence, writeBudget: budget }
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toMatchObject({ id: 'gr1' })
    expect(persistence.createGlobalReminder).toHaveBeenCalledWith(actor, {
      message: 'Town hall',
      remindAt: '2026-09-01T16:00:00.000Z',
    })
    // Global reminder administration is not a per-user quota write.
    expect(reserve).not.toHaveBeenCalled()
  })

  it('rejects an empty global reminder message', async () => {
    const persistence = makePersistence()
    const { budget } = makeBudget()
    const result = await createGlobalReminder(actor, { message: '  ', remindAt: '2026-09-01T16:00:00Z' }, {
      persistence,
      writeBudget: budget,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR')
    expect(persistence.createGlobalReminder).not.toHaveBeenCalled()
  })

  it('dismisses a global reminder for the actor', async () => {
    const persistence = makePersistence()
    const { budget } = makeBudget()
    const result = await dismissGlobalReminder(actor, 'gr1', { persistence, writeBudget: budget })
    expect(result.ok).toBe(true)
    expect(persistence.dismissGlobalReminder).toHaveBeenCalledWith(actor, 'gr1')
  })
})
