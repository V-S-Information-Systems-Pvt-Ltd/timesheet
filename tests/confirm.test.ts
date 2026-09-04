import { describe, expect, it } from 'vitest'

import { isConfirmUnlocked } from '@/app/components/confirm'

describe('isConfirmUnlocked', () => {
  it('allows a normal confirmation dialog without a typed token', () => {
    expect(isConfirmUnlocked(undefined, '')).toBe(true)
  })

  it('requires the supplied token when one is configured', () => {
    expect(isConfirmUnlocked('DELETE', '')).toBe(false)
    expect(isConfirmUnlocked('DELETE', 'delete')).toBe(true)
    expect(isConfirmUnlocked('', '')).toBe(false)
  })
})
