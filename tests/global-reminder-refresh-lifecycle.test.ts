import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalReminder } from '@/app/types'

// Execute the real provider and useAsyncData with a small hook scheduler. The
// repository's unit environment has no DOM renderer; dependency changes run
// cleanup before effects, while state/ref slots survive subsequent renders.
const hooks = vi.hoisted(() => {
  type Slot = { value?: unknown; initialized?: boolean; deps?: readonly unknown[]; cleanup?: () => void }
  let slots: Slot[] = []
  let cursor = 0
  let effects: Array<() => void> = []
  const slot = () => slots[cursor++] ?? (slots[cursor - 1] = {})
  const changed = (a?: readonly unknown[], b?: readonly unknown[]) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]))
  return {
    begin: () => { cursor = 0 },
    flush: () => { const pending = effects; effects = []; pending.forEach(effect => effect()) },
    reset: () => { slots.forEach(entry => entry.cleanup?.()); slots = []; cursor = 0; effects = [] },
    useState: <T,>(initial: T | (() => T)) => {
      const entry = slot()
      if (!entry.initialized) { entry.value = typeof initial === 'function' ? (initial as () => T)() : initial; entry.initialized = true }
      return [entry.value as T, (update: T | ((previous: T) => T)) => {
        entry.value = typeof update === 'function' ? (update as (previous: T) => T)(entry.value as T) : update
      }] as const
    },
    useRef: <T,>(initial: T) => {
      const entry = slot()
      if (!entry.initialized) { entry.value = { current: initial }; entry.initialized = true }
      return entry.value as { current: T }
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const entry = slot()
      if (!entry.initialized || changed(entry.deps, deps)) {
        entry.deps = deps; entry.initialized = true
        effects.push(() => { entry.cleanup?.(); entry.cleanup = effect() || undefined })
      }
    },
    useCallback: <T,>(callback: T, deps: readonly unknown[]) => {
      const entry = slot()
      if (!entry.initialized || changed(entry.deps, deps)) { entry.value = callback; entry.deps = deps; entry.initialized = true }
      return entry.value as T
    },
  }
})
const { read, dismiss } = vi.hoisted(() => ({ read: vi.fn(), dismiss: vi.fn() }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: hooks.useState, useRef: hooks.useRef, useEffect: hooks.useEffect, useCallback: hooks.useCallback,
}))
vi.mock('@/lib/data/client', () => ({ dataClient: { getDueGlobalReminders: read, dismissGlobalReminder: dismiss } }))
vi.mock('@/app/components/toast', () => ({ toast: vi.fn() }))

import { GlobalRemindersProvider } from '@/app/dashboard/global-reminders-panel'

type State = { data: GlobalReminder[] | null; dismiss: (id: string) => Promise<void> }
const row: GlobalReminder = { id: 'banner', message: 'Now due', remind_at: '2026-10-06T10:00:00Z', created_at: '2026-10-01T00:00:00Z', display_as_banner: true }
function render(tab: string): State {
  hooks.begin()
  const element = GlobalRemindersProvider({ children: null, refreshKey: tab })
  hooks.flush()
  return (element.props as { value: State }).value
}
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => { resolve = complete })
  return { promise, resolve }
}
beforeEach(() => { hooks.reset(); read.mockReset(); dismiss.mockReset() })
afterEach(() => hooks.reset())

describe('shared reminder refresh lifecycle', () => {
  it('fetches newly due/new reminders on tab changes and retains the provider on ordinary renders', async () => {
    read.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValue({ data: [row], error: null })
    render('user'); await settle()
    expect(render('user').data).toEqual([])
    expect(read).toHaveBeenCalledTimes(1)
    render('admin'); await settle()
    expect(render('admin').data).toEqual([row])
    expect(read).toHaveBeenCalledTimes(2)
    render('user'); await settle()
    expect(render('user').data).toEqual([row])
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('preserves dismissal and in-flight locks across tab refreshes', async () => {
    read.mockResolvedValue({ data: [row], error: null })
    const write = deferred<{ error: string | null }>()
    dismiss.mockReturnValue(write.promise)
    render('user'); await settle()
    const pending = render('user').dismiss(row.id)
    render('admin'); await settle()
    await render('admin').dismiss(row.id)
    expect(dismiss).toHaveBeenCalledTimes(1)
    write.resolve({ error: null }); await pending; await settle()
    expect(render('admin').data).toEqual([])
    // Even an eventually-consistent refresh cannot resurrect our dismissal.
    render('user'); await settle()
    expect(render('user').data).toEqual([])
  })

  it('rejects a late response from the previous tab refresh', async () => {
    const old = deferred<{ data: GlobalReminder[]; error: null }>()
    read.mockReturnValueOnce(old.promise).mockResolvedValue({ data: [row], error: null })
    render('user'); render('admin'); await settle()
    expect(render('admin').data).toEqual([row])
    old.resolve({ data: [], error: null }); await settle()
    expect(render('admin').data).toEqual([row])
  })
})
