import { describe, expect, it } from 'vitest'
import { HIERARCHY_ROLES, HIERARCHY_ROLE_LABELS, isLeaderHierarchy, legacyRoleFromPair } from '@/lib/roles'
import { roleForTitle } from '@/app/constants'

describe('Slice 04: Title-aligned hierarchy roles with engineer', () => {
  describe('Role Matrix & Helpers', () => {
    it('includes engineer in HIERARCHY_ROLES and maps to legacy user', () => {
      expect(HIERARCHY_ROLES).toContain('engineer')
      expect(HIERARCHY_ROLE_LABELS.engineer).toBe('Engineer')

      // Engineer maps to legacy 'user' when permission is 'user'
      expect(legacyRoleFromPair('user', 'engineer')).toBe('user')
      expect(legacyRoleFromPair('admin', 'engineer')).toBe('admin')
      expect(legacyRoleFromPair('pm', 'engineer')).toBe('pm')
      expect(legacyRoleFromPair('co', 'engineer')).toBe('co')

      // Manager and Team Lead map to their respective legacy roles
      expect(legacyRoleFromPair('user', 'manager')).toBe('manager')
      expect(legacyRoleFromPair('user', 'team_lead')).toBe('team_lead')
    })

    it('engineer has non-leadership visibility (isLeaderHierarchy is false)', () => {
      expect(isLeaderHierarchy('engineer')).toBe(false)
      expect(isLeaderHierarchy('user')).toBe(false)
      expect(isLeaderHierarchy('team_lead')).toBe(true)
      expect(isLeaderHierarchy('manager')).toBe(true)
    })

    it('derives correct hierarchy role from titles and custom classifications', () => {
      expect(roleForTitle('Systems Engineer')).toBe('engineer')
      expect(roleForTitle('Senior Systems Engineer')).toBe('engineer')
      expect(roleForTitle('Associate Systems Engineer')).toBe('engineer')
      expect(roleForTitle('Team Lead')).toBe('team_lead')
      expect(roleForTitle('Manager')).toBe('manager')
      expect(roleForTitle('Intern')).toBe('user')

      // Custom titles lookup
      const custom = [{ name: 'Solutions Architect', hierarchy_role: 'manager' as const }]
      expect(roleForTitle('Solutions Architect', custom)).toBe('manager')
    })
  })
})
