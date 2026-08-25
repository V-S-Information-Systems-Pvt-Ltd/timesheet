import { describe, expect, it } from 'vitest'
import { classifyAccountView, visibleAppNavKeys } from '../lib/navigation'

describe('visibleAppNavKeys', () => {
  it('keeps pending accounts on the dashboard approval flow', () => {
    expect(visibleAppNavKeys(false)).toEqual(['dashboard'])
  })

  it('exposes reports to active accounts', () => {
    expect(visibleAppNavKeys(true)).toEqual(['dashboard', 'reports'])
  })
})

describe('classifyAccountView', () => {
  it('routes a failed profile load to the error view, not pending approval', () => {
    expect(classifyAccountView(null, 'Network error.')).toBe('error')
  })

  it('treats a missing profile row as an error, not pending approval', () => {
    expect(classifyAccountView(null, null)).toBe('error')
  })

  it('shows the approval screen only for a loaded inactive profile', () => {
    expect(classifyAccountView({ is_active: false }, null)).toBe('pending')
  })

  it('admits a loaded active profile to the app', () => {
    expect(classifyAccountView({ is_active: true }, null)).toBe('ready')
  })
})
