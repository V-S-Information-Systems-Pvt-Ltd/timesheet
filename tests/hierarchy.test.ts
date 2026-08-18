// tests/hierarchy.test.ts
// Pure-logic tests for the report-to ("Reports to") dropdown helpers.
import { describe, expect, it } from 'vitest'
import { isLeaderRole, leaderUsers, reportToOptions } from '../lib/hierarchy'
import type { User } from '../app/types'

const user = (id: string, role: User['role'] = 'user', manager_id: string | null = null): User => ({
  id,
  email: `${id}@x.com`,
  name: `User ${id}`,
  department: '',
  title: '',
  role,
  is_active: true,
  manager_id,
  dashboard_layout: null,
  admin_layout: null,
  created_at: '',
})

describe('isLeaderRole / leaderUsers', () => {
  it('recognises manager and team_lead only', () => {
    expect(isLeaderRole('manager')).toBe(true)
    expect(isLeaderRole('team_lead')).toBe(true)
    expect(isLeaderRole('admin')).toBe(false)
    expect(isLeaderRole('pm')).toBe(false)
    expect(isLeaderRole('co')).toBe(false)
    expect(isLeaderRole('user')).toBe(false)
  })

  it('filters leader candidates out of a user list', () => {
    const users = [
      user('a', 'admin'),
      user('b', 'manager'),
      user('c', 'team_lead'),
      user('d', 'user'),
    ]
    expect(leaderUsers(users).map((u) => u.id)).toEqual(['b', 'c'])
  })
})

describe('reportToOptions', () => {
  it('offers every leader except the user themself', () => {
    const users = [user('me', 'user'), user('m1', 'manager'), user('m2', 'team_lead')]
    const options = reportToOptions(users[0], users)
    expect(options.map((u) => u.id)).toEqual(['m1', 'm2'])
  })

  it('does not offer the user themself even when they are a leader', () => {
    const users = [user('boss', 'manager'), user('other', 'user')]
    const options = reportToOptions(users[0], users)
    expect(options).toEqual([]) // no other leader exists to report to
  })

  it('keeps a current manager that was demoted, so the value never shows as "— None —"', () => {
    const boss = user('boss', 'manager')
    const demoted = user('demoted', 'user') // no longer a leader, but still the current manager
    const me = user('me', 'user', demoted.id)
    const options = reportToOptions(me, [me, boss, demoted])
    expect(options.map((u) => u.id)).toEqual(['boss', 'demoted'])
  })

  it('dedupes when the current manager is still a leader', () => {
    const boss = user('boss', 'manager')
    const me = user('me', 'user', boss.id)
    const options = reportToOptions(me, [me, boss])
    expect(options.map((u) => u.id)).toEqual(['boss'])
  })

  it('returns an empty list when there are no leaders and no current manager', () => {
    const me = user('me', 'user')
    const options = reportToOptions(me, [me, user('other', 'user')])
    expect(options).toEqual([])
  })
})