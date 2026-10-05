import { describe, expect, it, vi } from 'vitest'
import { runBulkEditMutation } from '@/app/dashboard/bulk-edit-modal'
import type { dataClient } from '@/lib/data/client'

type Payload = Parameters<typeof dataClient.bulkUpdateTimesheets>[0]
const payload = (): Payload => ['one', 'two'].map(id => ({ id, projectId: 'p', activityTypeId: 'a', hoursWorked: 2, workDone: 'Original', logDate: '2020-01-01' }))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}
function lifecycle() {
  const locks = new Set<string>()
  const selected = new Set(['one', 'two'])
  const start = vi.fn(() => {
    if (locks.size) return false
    selected.clear()
    locks.add('one'); locks.add('two')
    return true
  })
  const release = vi.fn(() => locks.clear())
  const reconcile = vi.fn(async () => {
    expect([...locks]).toEqual(['one', 'two'])
    return true
  })
  return { locks, selected, start, release, reconcile, isSessionCurrent: () => true }
}

describe('captured bulk edit lifecycle', () => {
  it('captures primitive row values, invalidates reusable selection and holds every lock through reconciliation', async () => {
    const input = payload()
    const current = lifecycle()
    const writeGate = deferred<{ error: null; updated: number }>()
    const readGate = deferred<boolean>()
    const write = vi.fn((_snapshot: Payload) => writeGate.promise)
    current.reconcile.mockImplementation(() => readGate.promise)
    const request = runBulkEditMutation(input, { ...current, write })
    expect([...current.locks]).toEqual(['one', 'two'])
    expect(current.selected.size).toBe(0)
    input[0].workDone = 'Changed after submission'
    input.splice(1)
    expect(write.mock.calls[0][0]).toHaveLength(2)
    expect(write.mock.calls[0][0][0].workDone).toBe('Original')
    writeGate.resolve({ error: null, updated: 2 })
    await Promise.resolve()
    expect(current.reconcile).toHaveBeenCalledTimes(1)
    expect(current.release).not.toHaveBeenCalled()
    expect(current.locks.size).toBe(2)
    readGate.resolve(true)
    expect(await request).toEqual({ error: null, updated: 2, refreshed: true })
    expect(current.locks.size).toBe(0)
    expect(current.release).toHaveBeenCalledTimes(1)
  })
  it.each(['rejected', 'partial', 'throw'])('reconciles %s writes before releasing locks; no selection is reusable', async mode => {
    const current = lifecycle()
    const write = vi.fn(async () => {
      expect(current.locks.size).toBe(2)
      if (mode === 'throw') throw new Error('Transport failure')
      return mode === 'partial' ? { error: null, updated: 1, errors: ['Second row failed'] } : { error: 'Rejected' }
    })
    const result = await runBulkEditMutation(payload(), { ...current, write })
    expect(result).toMatchObject({ refreshed: true })
    if (mode === 'throw') expect(result?.error).toContain('Could not confirm')
    if (mode === 'partial') expect(result?.updated).toBe(1)
    expect(current.reconcile).toHaveBeenCalledTimes(1)
    expect(current.release).toHaveBeenCalledTimes(1)
    expect(current.locks.size).toBe(0)
    expect(current.selected.size).toBe(0)
  })
  it('releases all locks after a thrown read and reports unconfirmed refresh', async () => {
    const current = lifecycle()
    current.reconcile.mockRejectedValueOnce(new Error('Read failed'))
    expect(await runBulkEditMutation(payload(), { ...current, write: async () => ({ error: null, updated: 2 }) })).toMatchObject({ refreshed: false })
    expect(current.locks.size).toBe(0)
  })
  it('does not issue a second write when another batch owns the parent locks', async () => {
    const current = lifecycle()
    const pending = deferred<{ error: null; updated: number }>()
    const write = vi.fn(() => pending.promise)
    const first = runBulkEditMutation(payload(), { ...current, write })
    expect(await runBulkEditMutation(payload(), { ...current, write })).toBeNull()
    expect(write).toHaveBeenCalledTimes(1)
    expect(current.release).not.toHaveBeenCalled()
    pending.resolve({ error: null, updated: 2 })
    await first
    expect(current.locks.size).toBe(0)
  })
  it('rejects stale sessions before starting and never reconciles a completed old-session write in the replacement session', async () => {
    const current = lifecycle()
    const pending = deferred<{ error: null; updated: number }>()
    let session = 1
    const write = vi.fn(() => pending.promise)
    // The parent release closure belongs to the initiating session and must
    // not remove a same-ID lock acquired later in the shared replacement set.
    const release = vi.fn(() => { if (session === 1) current.locks.clear() })
    const request = runBulkEditMutation(payload(), { ...current, release, write, isSessionCurrent: () => session === 1 })
    session = 2
    current.locks.clear()
    current.locks.add('one')
    pending.resolve({ error: null, updated: 2 })
    expect(await request).toMatchObject({ refreshed: false })
    expect(current.reconcile).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(1)
    expect([...current.locks]).toEqual(['one'])
    expect(await runBulkEditMutation(payload(), { ...current, write, isSessionCurrent: () => false })).toBeNull()
    expect(write).toHaveBeenCalledTimes(1)
  })
})
