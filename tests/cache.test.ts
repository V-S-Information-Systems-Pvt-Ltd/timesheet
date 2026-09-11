// tests/cache.test.ts
// Tests for the localStorage recent-work cache: deduplication, ordering,
// eviction, and graceful degradation when storage is unavailable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRecentWorkDetailed, saveRecentWorkDetailed } from '../lib/cache'

const STORAGE_KEY = 'vsis-recent-work'

function makeStore() {
  const store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((k) => delete store[k])
    }),
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    get length() {
      return Object.keys(store).length
    },
    __store: store,
  }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getRecentWorkDetailed / saveRecentWorkDetailed', () => {
  it('returns empty array when localStorage is empty', () => {
    const mock = makeStore()
    vi.stubGlobal('localStorage', mock)
    expect(getRecentWorkDetailed()).toEqual([])
  })

  it('saves and retrieves a detailed entry', () => {
    const mock = makeStore()
    vi.stubGlobal('localStorage', mock)
    const next = saveRecentWorkDetailed({ text: 'Deploy fix', project: 'Platform', date: '2024-06-01' })
    expect(next).toEqual([{ text: 'Deploy fix', project: 'Platform', date: '2024-06-01' }])
    expect(getRecentWorkDetailed()).toEqual([{ text: 'Deploy fix', project: 'Platform', date: '2024-06-01' }])
  })

  it('deduplicates by text and moves to top', () => {
    const mock = makeStore()
    vi.stubGlobal('localStorage', mock)
    saveRecentWorkDetailed({ text: 'First', date: '2024-01-01' })
    saveRecentWorkDetailed({ text: 'Second', date: '2024-01-02' })
    saveRecentWorkDetailed({ text: 'First', date: '2024-01-03' })
    expect(getRecentWorkDetailed()).toEqual([
      { text: 'First', date: '2024-01-03' },
      { text: 'Second', date: '2024-01-02' },
    ])
  })

  it('evicts entries beyond the max of 10', () => {
    const mock = makeStore()
    vi.stubGlobal('localStorage', mock)
    for (let i = 1; i <= 12; i++) {
      saveRecentWorkDetailed({ text: `Task ${i}`, date: '2024-01-01' })
    }
    const result = getRecentWorkDetailed()
    expect(result).toHaveLength(10)
    expect(result[0]?.text).toBe('Task 12')
    expect(result[9]?.text).toBe('Task 3')
  })

  it('ignores empty or whitespace-only text', () => {
    const mock = makeStore()
    vi.stubGlobal('localStorage', mock)
    saveRecentWorkDetailed({ text: 'Real task', date: '2024-01-01' })
    saveRecentWorkDetailed({ text: '', date: '2024-01-02' })
    saveRecentWorkDetailed({ text: '   ', date: '2024-01-03' })
    expect(getRecentWorkDetailed().map(entry => entry.text)).toEqual(['Real task'])
  })

  it('returns [] when localStorage throws in private mode', () => {
    const mock = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error('Private mode')
      }),
      removeItem: vi.fn(() => {
        throw new Error('Private mode')
      }),
    }
    vi.stubGlobal('localStorage', mock)
    expect(getRecentWorkDetailed()).toEqual([])
    expect(saveRecentWorkDetailed({ text: 'test', date: '2024-01-01' })).toEqual([])
  })

  it('recovers from corrupted JSON in storage', () => {
    const mock = makeStore()
    mock.__store[STORAGE_KEY] = 'not-valid-json'
    vi.stubGlobal('localStorage', mock)
    expect(getRecentWorkDetailed()).toEqual([])
  })

  it('migrates old string format to objects with empty date', () => {
    const mock = makeStore()
    mock.__store[STORAGE_KEY] = JSON.stringify(['Old task', 'Another task'])
    vi.stubGlobal('localStorage', mock)
    expect(getRecentWorkDetailed()).toEqual([
      { text: 'Old task', date: '' },
      { text: 'Another task', date: '' },
    ])
  })

  it('returns [] for mixed arrays (strings + objects)', () => {
    const mock = makeStore()
    mock.__store[STORAGE_KEY] = JSON.stringify(['string', { text: 'object' }])
    vi.stubGlobal('localStorage', mock)
    expect(getRecentWorkDetailed()).toEqual([])
  })

  it('returns [] when new-format array contains invalid entries', () => {
    const mock = makeStore()
    mock.__store[STORAGE_KEY] = JSON.stringify([{ text: '' }, null, undefined])
    vi.stubGlobal('localStorage', mock)
    expect(getRecentWorkDetailed()).toEqual([])
  })

})
