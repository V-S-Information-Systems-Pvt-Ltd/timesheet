// lib/cache.ts
// Client-side localStorage cache helpers for user-entered data that should
// persist across sessions (e.g. recent "work done" descriptions).
// All access is guarded so private-browsing mode never throws.

const STORAGE_KEY = 'vsis-recent-work'
const MAX_RECENT = 10

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const test = '__vsis_test__'
    localStorage.setItem(test, test)
    localStorage.removeItem(test)
    return localStorage
  } catch {
    return null
  }
}

export function getRecentWork(): string[] {
  const storage = safeStorage()
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : []
  } catch {
    return []
  }
}

export function saveRecentWork(text: string): string[] {
  const storage = safeStorage()
  if (!storage) return []
  const trimmed = text.trim()
  if (!trimmed) return getRecentWork()
  try {
    const existing = getRecentWork()
    const next = [trimmed, ...existing.filter((w) => w !== trimmed)].slice(0, MAX_RECENT)
    storage.setItem(STORAGE_KEY, JSON.stringify(next))
    return next
  } catch {
    return []
  }
}
