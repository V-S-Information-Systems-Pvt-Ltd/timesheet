// tests/domain-whitelist.test.ts
import { describe, expect, it } from 'vitest'
import { TITLES, roleForTitle } from '../app/constants'
import { HIERARCHY_ROLES } from '../lib/roles'

describe('roleForTitle', () => {
  it('maps standard titles to hierarchy roles', () => {
    expect(roleForTitle('Manager')).toBe('manager')
    expect(roleForTitle('Team Lead')).toBe('team_lead')
    expect(roleForTitle('Intern')).toBe('user')
    expect(roleForTitle('Associate Systems Engineer')).toBe('user')
    expect(roleForTitle('Systems Engineer')).toBe('user')
    expect(roleForTitle('Senior Systems Engineer')).toBe('user')
  })

  it('never returns a permission role: a title only sets the hierarchy axis', () => {
    // In the two-axis model the title must not imply admin/pm/co powers —
    // the permission axis is set explicitly and independently.
    for (const title of TITLES) {
      expect(HIERARCHY_ROLES).toContain(roleForTitle(title))
    }
    expect(roleForTitle('Manager')).not.toBe('admin')
    expect(roleForTitle('Systems Engineer')).not.toBe('co')
  })

  it('recomputes hierarchy roles from a mismatched title', () => {
    // These are the exact checks the server action uses to reject a
    // contradictory title+hierarchy-role save.
    expect(roleForTitle('Manager')).toBe('manager')
    expect(roleForTitle('Team Lead')).toBe('team_lead')
    expect(roleForTitle('Systems Engineer')).toBe('user')
  })

  it('contains all 6 required standard titles', () => {
    expect(TITLES).toEqual([
      'Intern',
      'Associate Systems Engineer',
      'Systems Engineer',
      'Senior Systems Engineer',
      'Team Lead',
      'Manager',
    ])
  })
})