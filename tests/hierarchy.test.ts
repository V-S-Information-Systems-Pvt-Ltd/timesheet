// tests/hierarchy.test.ts
// Pure-logic tests for the report-to ("Reports to") dropdown helpers and the
// reporting-cycle guard. Hierarchy is the SEPARATE reporting axis
// (hierarchy_role), independent of the permission axis.
import { describe, expect, it } from 'vitest'
import { leaderUsers, reportToOptions, wouldCreateHierarchyCycle } from '../lib/hierarchy'
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
  mobile_layout: null,
  created_at: '',
})

describe('isLeaderHierarchy / leaderUsers', () => {
  it('recognises manager and team_lead hierarchy only, rejecting engineer and user', () => {
    expect(isLeaderHierarchy('manager')).toBe(true)
    expect(isLeaderHierarchy('team_lead')).toBe(true)
    expect(isLeaderHierarchy('engineer')).toBe(false)
    expect(isLeaderHierarchy('user')).toBe(false)
  })

  it('leaders are hierarchical positions, independent of permission role', () => {
    // Permission role does not make someone a leader; hierarchy position does.
    expect(isLeaderHierarchy('user')).toBe(false)
    expect(isLeaderHierarchy('engineer')).toBe(false)
  })

  it('filters leader candidates out of a user list including engineers', () => {
    const users = [
      user('a', 'admin'), // admin permission, leaf hierarchy -> NOT a leader
      user('b', 'pm', 'manager'),
      user('c', 'user', 'team_lead'),
      user('d', 'user', 'engineer'), // engineer -> NOT a leader
      user('e', 'user'),
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

  it('excludes targets that would create a circular reporting loop', () => {
    // A reports to B. If B tried to report to A, B -> A -> B would be a cycle,
    // so A must not be offered to B.
    const userA = user('a', 'user', 'manager', 'b')
    const userB = user('b', 'user', 'manager')
    const userC = user('c', 'user', 'manager')
    const optionsForB = reportToOptions(userB, [userA, userB, userC])
    expect(optionsForB.map((u) => u.id)).toEqual(['c'])
  })

  it('returns an empty list when there are no leaders and no current manager', () => {
    const me = user('me')
    const options = reportToOptions(me, [me, user('other')])
    expect(options).toEqual([])
  })
})

describe('wouldCreateHierarchyCycle', () => {
  it('detects direct circular reporting (A -> B -> A)', () => {
    const userA = user('a', 'user', 'manager', 'b')
    const userB = user('b', 'user', 'manager')
    expect(wouldCreateHierarchyCycle([userA, userB], 'b', 'a')).toBe(true)
  })

  it('detects indirect circular reporting (A -> B -> C -> A)', () => {
    const userA = user('a', 'user', 'manager', 'b')
    const userB = user('b', 'user', 'manager', 'c')
    const userC = user('c', 'user', 'manager')
    expect(wouldCreateHierarchyCycle([userA, userB, userC], 'c', 'a')).toBe(true)
  })

  it('allows valid tree structures without cycles', () => {
    const userA = user('a', 'user', 'manager')
    const userB = user('b', 'user', 'manager', 'a')
    const userC = user('c')
    expect(wouldCreateHierarchyCycle([userA, userB, userC], 'c', 'b')).toBe(false)
  })

  it('rejects self-reporting', () => {
    const userA = user('a', 'user', 'manager')
    expect(wouldCreateHierarchyCycle([userA], 'a', 'a')).toBe(true)
  })
})