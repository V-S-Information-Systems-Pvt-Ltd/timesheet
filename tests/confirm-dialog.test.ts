// tests/confirm-dialog.test.ts
// Unit tests for confirmation dialog unlocking rules (WP-02 §1).
import { describe, expect, it } from 'vitest'

function isConfirmUnlocked(confirmValue: string | undefined, typed: string): boolean {
  return (
    confirmValue === undefined ||
    confirmValue.trim().length === 0 ||
    typed.trim().toLowerCase() === confirmValue.trim().toLowerCase()
  )
}

describe('ConfirmDialog unlock logic', () => {
  it('unlocks immediately when confirmValue is undefined (ordinary confirmation)', () => {
    expect(isConfirmUnlocked(undefined, '')).toBe(true)
    expect(isConfirmUnlocked(undefined, 'anything')).toBe(true)
  })

  it('unlocks immediately when confirmValue is empty string or whitespace', () => {
    expect(isConfirmUnlocked('', '')).toBe(true)
    expect(isConfirmUnlocked('   ', '')).toBe(true)
  })

  it('stays locked when typed value does not match confirmValue', () => {
    expect(isConfirmUnlocked('DELETE', '')).toBe(false)
    expect(isConfirmUnlocked('DELETE', 'DEL')).toBe(false)
    expect(isConfirmUnlocked('DELETE', 'deletee')).toBe(false)
  })

  it('unlocks when typed value matches confirmValue (case-insensitive and trimmed)', () => {
    expect(isConfirmUnlocked('DELETE', 'delete')).toBe(true)
    expect(isConfirmUnlocked('DELETE', ' DELETE ')).toBe(true)
    expect(isConfirmUnlocked('admin@vsis.lk', 'ADMIN@VSIS.LK')).toBe(true)
  })
})
