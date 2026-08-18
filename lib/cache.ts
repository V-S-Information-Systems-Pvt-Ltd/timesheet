// lib/cache.ts
// Client-side localStorage cache helpers for user-entered data that should
// persist across sessions (e.g. recent "work done" descriptions).
// All access is guarded so private-browsing mode never throws.

import { todayISO } from './dates'

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

export interface CachedWorkEntry {
  text: string
  project?: string
  date: string
}

function migrateOldFormat(raw: unknown): CachedWorkEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(text => ({ text, date: '' }))
}

function readRaw(): unknown {
  const storage = safeStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeRaw(value: unknown): boolean {
  const storage = safeStorage()
  if (!storage) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function getRecentWork(): string[] {
  const entries = getRecentWorkDetailed()
  return entries.map(e => e.text)
}

export function saveRecentWork(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return getRecentWork()
  const next = saveRecentWorkDetailed({ text: trimmed, date: todayISO() })
  return next.map(e => e.text)
}

export function getRecentWorkDetailed(): CachedWorkEntry[] {
  const raw = readRaw()
  if (raw === null) return []
  if (Array.isArray(raw)) {
    if (raw.length === 0) return []
    const hasObjects = raw.some(v => v != null && typeof v === 'object' && typeof (v as CachedWorkEntry).text === 'string')
    const hasStrings = raw.some(v => typeof v === 'string')
    if (hasObjects && !hasStrings) {
      return raw.filter((v): v is CachedWorkEntry => v != null && typeof v === 'object' && typeof (v as CachedWorkEntry).text === 'string' && (v as CachedWorkEntry).text.trim().length > 0)
    }
    if (hasStrings && !hasObjects) {
      return migrateOldFormat(raw)
    }
    return []
  }
  return []
}

export function saveRecentWorkDetailed(entry: CachedWorkEntry): CachedWorkEntry[] {
  const text = entry.text.trim()
  if (!text) return getRecentWorkDetailed()
  const existing = getRecentWorkDetailed()
  const next = [
    { ...entry, text },
    ...existing.filter(e => e.text !== text),
  ].slice(0, MAX_RECENT)
  if (!writeRaw(next)) return getRecentWorkDetailed()
  return next
}
