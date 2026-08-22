// tests/domain-whitelist.test.ts
import { describe, expect, it } from 'vitest'
import { TITLES, roleForTitle } from '../app/constants'

describe('roleForTitle', () => {
  it('maps standard titles to correct roles', () => {
    expect(roleForTitle('Manager')).toBe('manager')
    expect(roleForTitle('Team Lead')).toBe('team_lead')
    expect(roleForTitle('Intern')).toBe('user')
    expect(roleForTitle('Associate Systems Engineer')).toBe('user')
    expect(roleForTitle('Systems Engineer')).toBe('user')
    expect(roleForTitle('Senior Systems Engineer')).toBe('user')
  })

  it('preserves administrative roles (admin, pm, co)', () => {
    expect(roleForTitle('Manager', 'admin')).toBe('admin')
    expect(roleForTitle('Team Lead', 'pm')).toBe('pm')
    expect(roleForTitle('Senior Systems Engineer', 'co')).toBe('co')
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
