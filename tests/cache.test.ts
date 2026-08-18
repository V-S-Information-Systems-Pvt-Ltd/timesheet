// tests/cache.test.ts
// Tests for the localStorage recent-work cache: deduplication, ordering,
// eviction, and graceful degradation when storage is unavailable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRecentWork, saveRecentWork } from '../lib/cache'

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

describe('getRecentWork / saveRecentWork', () => {
  it('returns an empty array when localStorage is empty', () => {
    const mock = makeStore()
    vi.stubGlobal('localStorage', mock)
    expect(getRecentWork()).toEqual([])
  })

  it('saves and retrieves a single work description', () => {
    const mock = makeStore()
    vi.stubGlobal('localStorage', mock)
    saveRecentWork('Fixed the login bug')
    expect(getRecentWork()).toEqual(['Fixed the login bug'])
  })

  it('orders most-recent-first', () => {
    const mock = makeStore()
    vi.stubGlobal('localStorage', mock)
    saveRecentWork('First task')
    saveRecentWork('Second task')
    expect(getRecentWork()).toEqual(['Second task', 'First task'])
  })

  it('deduplicates: re-saving a description moves it to the top', () => {
    const mock = makeStore()
    vi.stubGlobal('localStorage', mock)
    saveRecentWork('First task')
    saveRecentWork('Second task')
    saveRecentWork('First task')
    expect(getRecentWork()).toEqual(['First task', 'Second task'])
  })

  it('evicts entries beyond the max of 10', () => {
    const mock = makeStore()
    vi.stubGlobal('localStorage', mock)
    for (let i = 1; i <= 12; i++) {
      saveRecentWork(`Task ${i}`)
    }
    const result = getRecentWork()
    expect(result).toHaveLength(10)
    expect(result[0]).toBe('Task 12')
    expect(result[9]).toBe('Task 3')
  })

  it('ignores empty or whitespace-only input', () => {
    const mock = makeStore()
    vi.stubGlobal('localStorage', mock)
    saveRecentWork('Real task')
    saveRecentWork('')
    saveRecentWork('   ')
    expect(getRecentWork()).toEqual(['Real task'])
  })

  it('returns [] when localStorage throws (private mode)', () => {
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
    expect(getRecentWork()).toEqual([])
    expect(saveRecentWork('test')).toEqual([])
  })

  it('recovers from corrupted JSON in storage', () => {
    const mock = makeStore()
    mock.__store[STORAGE_KEY] = 'not-valid-json'
    vi.stubGlobal('localStorage', mock)
    expect(getRecentWork()).toEqual([])
  })
})
