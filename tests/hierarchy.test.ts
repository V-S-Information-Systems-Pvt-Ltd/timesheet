// tests/hierarchy.test.ts
// Pure-logic tests for the report-to ("Reports to") dropdown helpers.
import { describe, expect, it } from 'vitest'
import { leaderUsers, reportToOptions } from '../lib/hierarchy'
import { isLeaderHierarchy, legacyRoleFromPair } from '../lib/roles'
import type { HierarchyRole, PermissionRole, User } from '../app/types'

const user = (
  id: string,
  permission: PermissionRole = 'user',
  hierarchy: HierarchyRole = 'user',
  manager_id: string | null = null
): User => ({
  id,
  email: `${id}@x.com`,
  name: `User ${id}`,
  department: '',
  title: '',
  role: legacyRoleFromPair(permission, hierarchy),
  permission_role: permission,
  hierarchy_role: hierarchy,
  is_active: true,
  manager_id,
  dashboard_layout: null,
  admin_layout: null,
  created_at: '',
})

describe('isLeaderHierarchy / leaderUsers', () => {
  it('recognises manager and team_lead hierarchy only', () => {
    expect(isLeaderHierarchy('manager')).toBe(true)
    expect(isLeaderHierarchy('team_lead')).toBe(true)
    expect(isLeaderHierarchy('user')).toBe(false)
  })

  it('leaders are hierarchical positions, independent of permission role', () => {
    // Permission role does not make someone a leader; hierarchy position does.
    expect(isLeaderHierarchy('user')).toBe(false)
  })

  it('filters leader candidates out of a user list', () => {
    const users = [
      user('a', 'admin'), // admin permission, leaf hierarchy -> NOT a leader
      user('b', 'pm', 'manager'),
      user('c', 'user', 'team_lead'),
      user('d', 'user'),
    ]
    expect(leaderUsers(users).map((u) => u.id)).toEqual(['b', 'c'])
  })
})

describe('reportToOptions', () => {
  it('offers every leader except the user themself', () => {
    const users = [user('me'), user('m1', 'user', 'manager'), user('m2', 'user', 'team_lead')]
    const options = reportToOptions(users[0], users)
    expect(options.map((u) => u.id)).toEqual(['m1', 'm2'])
  })

  it('does not offer the user themself even when they are a leader', () => {
    const users = [user('boss', 'user', 'manager'), user('other')]
    const options = reportToOptions(users[0], users)
    expect(options).toEqual([]) // no other leader exists to report to
  })

  it('keeps a current manager that was demoted, so the value never shows as "— None —"', () => {
    const boss = user('boss', 'user', 'manager')
    const demoted = user('demoted') // no longer a leader, but still the current manager
    const me = user('me', 'user', 'user', demoted.id)
    const options = reportToOptions(me, [me, boss, demoted])
    expect(options.map((u) => u.id)).toEqual(['boss', 'demoted'])
  })

  it('dedupes when the current manager is still a leader', () => {
    const boss = user('boss', 'user', 'manager')
    const me = user('me', 'user', 'user', boss.id)
    const options = reportToOptions(me, [me, boss])
    expect(options.map((u) => u.id)).toEqual(['boss'])
  })

  it('a leader with only permission pm (leaf hierarchy) is not a reporting target', () => {
    const pm = user('p', 'pm')
    const me = user('me')
    const options = reportToOptions(me, [me, pm])
    expect(options).toEqual([])
  })

  it('returns an empty list when there are no leaders and no current manager', () => {
    const me = user('me')
    const options = reportToOptions(me, [me, user('other')])
    expect(options).toEqual([])
  })
})
