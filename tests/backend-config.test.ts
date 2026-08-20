// tests/backend-config.test.ts
// Tests for the dual-backend mode resolution logic.
import { describe, expect, it } from 'vitest'
import { resolveBackend, BACKENDS } from '../lib/backend/config'

describe('resolveBackend', () => {
  it('defaults to supabase when undefined', () => {
    expect(resolveBackend(undefined)).toBe('supabase')
  })

  it('defaults to supabase when empty string', () => {
    expect(resolveBackend('')).toBe('supabase')
  })

  it('accepts supabase', () => {
    expect(resolveBackend('supabase')).toBe('supabase')
  })

  it('accepts native', () => {
    expect(resolveBackend('native')).toBe('native')
  })

  it('rejects unknown values', () => {
    expect(() => resolveBackend('postgres')).toThrow('Invalid NEXT_PUBLIC_BACKEND')
    expect(() => resolveBackend('supabase2')).toThrow('Invalid NEXT_PUBLIC_BACKEND')
  })
})

describe('BACKENDS', () => {
  it('contains exactly supabase and native', () => {
    expect(BACKENDS).toEqual(['supabase', 'native'] as const)
  })
})
