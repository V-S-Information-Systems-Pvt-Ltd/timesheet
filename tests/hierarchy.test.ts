// tests/hierarchy.test.ts
// Pure-logic tests for the report-to ("Reports to") dropdown helpers.
import { describe, expect, it } from 'vitest'
import { isLeaderRole, leaderUsers, reportToOptions, wouldCreateHierarchyCycle } from '../lib/hierarchy'
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
  it('offers all eligible users (Engineers, Senior Engineers, Leads, Managers) except the user themself', () => {
    const me = { ...user('me', 'user'), title: 'Associate Systems Engineer' }
    const engineer = { ...user('eng', 'user'), title: 'Systems Engineer' }
    const seniorEng = { ...user('sr_eng', 'user'), title: 'Senior Systems Engineer' }
    const lead = { ...user('lead', 'team_lead'), title: 'Team Lead' }
    const manager = { ...user('mgr', 'manager'), title: 'Manager' }

    const options = reportToOptions(me, [me, engineer, seniorEng, lead, manager])
    expect(options.map((u) => u.id)).toEqual(['eng', 'sr_eng', 'lead', 'mgr'])
  })

  it('does not offer the user themself', () => {
    const users = [user('boss', 'manager')]
    const options = reportToOptions(users[0], users)
    expect(options).toEqual([])
  })

  it('excludes users that would create a circular reporting hierarchy loop', () => {
    // Structure: A -> reports to B.
    // B wants to change reporting line. A should NOT be an option for B because B -> A -> B is a cycle.
    const userA = user('a', 'user', 'b')
    const userB = user('b', 'user', null)
    const userC = user('c', 'user', null)

    const optionsForB = reportToOptions(userB, [userA, userB, userC])
    expect(optionsForB.map((u) => u.id)).toEqual(['c'])
  })
})

describe('wouldCreateHierarchyCycle', () => {
  it('detects direct circular reporting (A -> B -> A)', () => {
    const userA = user('a', 'manager', 'b')
    const userB = user('b', 'manager', null)
    expect(wouldCreateHierarchyCycle([userA, userB], 'b', 'a')).toBe(true)
  })

  it('detects indirect circular reporting (A -> B -> C -> A)', () => {
    const userA = user('a', 'manager', 'b')
    const userB = user('b', 'manager', 'c')
    const userC = user('c', 'manager', null)
    expect(wouldCreateHierarchyCycle([userA, userB, userC], 'c', 'a')).toBe(true)
  })

  it('allows valid tree structures without cycles', () => {
    const userA = user('a', 'manager', null)
    const userB = user('b', 'manager', 'a')
    const userC = user('c', 'user', null)
    expect(wouldCreateHierarchyCycle([userA, userB, userC], 'c', 'b')).toBe(false)
  })

  it('rejects self-reporting', () => {
    const userA = user('a', 'manager', null)
    expect(wouldCreateHierarchyCycle([userA], 'a', 'a')).toBe(true)
  })
})