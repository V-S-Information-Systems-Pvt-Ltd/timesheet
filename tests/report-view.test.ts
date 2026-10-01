import { describe, expect, it } from 'vitest'
import { reportUserId } from '@/app/reports/view'

describe('report view user scope', () => {
  it('keeps personal charts, rows, totals, and exports personal after a group filter changes', () => {
    for (const tab of ['myhours', 'summaries']) {
      expect(reportUserId(tab, 'all', 'viewer')).toBe('viewer')
      expect(reportUserId(tab, 'another-user', 'viewer')).toBe('viewer')
    }
  })

  it('preserves group report all, me, and selected-user filters', () => {
    expect(reportUserId('reports', 'all', 'viewer')).toBeNull()
    expect(reportUserId('reports', 'me', 'viewer')).toBe('viewer')
    expect(reportUserId('reports', 'another-user', 'viewer')).toBe('another-user')
  })

  it('does not widen a personal view to all users when identity is unavailable', () => {
    expect(reportUserId('myhours', 'all', undefined)).not.toBeNull()
  })
})
