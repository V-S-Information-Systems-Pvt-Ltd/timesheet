import { describe, expect, it, vi, beforeEach } from 'vitest'
import { HIERARCHY_ROLES, HIERARCHY_ROLE_LABELS, isLeaderHierarchy, legacyRoleFromPair } from '@/lib/roles'
import { roleForTitle } from '@/app/constants'
import { addUser, updateUserHierarchy, updateMyProfile } from '@/app/actions/users'
import { addTitle, getTitleImpact, reclassifyTitle } from '@/app/actions/superadmin'
import { getTitleRecords } from '@/app/actions/settings'
import { getActor } from '@/lib/auth'
import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import type { TitleRecord } from '@/app/types'

vi.mock('@/lib/auth', () => ({
  getActor: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    listTitleRecords: vi.fn(),
    listTitles: vi.fn(),
    addTitle: vi.fn(),
    getTitleImpact: vi.fn(),
    reclassifyTitle: vi.fn(),
    deleteTitle: vi.fn(),
    createUser: vi.fn(),
    updateUserHierarchy: vi.fn(),
    updateMyProfile: vi.fn(),
    getProfileById: vi.fn(),
    listProfiles: vi.fn(),
    findWhitelistedDomain: vi.fn(),
    writeAuditLog: vi.fn(),
  },
}))

const mockGetActor = vi.mocked(getActor)
const mockRepo = repo as unknown as Record<string, ReturnType<typeof vi.fn>>

const sampleTitles: TitleRecord[] = [
  { id: '1', name: 'Intern', hierarchy_role: 'user', created_at: '2026-01-01' },
  { id: '2', name: 'Systems Engineer', hierarchy_role: 'engineer', created_at: '2026-01-01' },
  { id: '3', name: 'Senior Systems Engineer', hierarchy_role: 'engineer', created_at: '2026-01-01' },
  { id: '4', name: 'Team Lead', hierarchy_role: 'team_lead', created_at: '2026-01-01' },
  { id: '5', name: 'Manager', hierarchy_role: 'manager', created_at: '2026-01-01' },
]

describe('Slice 04: Title-aligned hierarchy roles with engineer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPER_ADMIN_EMAIL = 'super@vsis.lk'
    mockRepo.listTitleRecords.mockResolvedValue(sampleTitles)
    mockRepo.findWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'vsis.lk', auto_activate: true, created_at: '' })
    mockRepo.writeAuditLog.mockResolvedValue({ error: null })
  })

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

  describe('User Creation & Hierarchy Validation', () => {
    const adminActor: Actor = {
      id: 'admin-1',
      email: 'admin@vsis.lk',
      role: 'admin',
      permission_role: 'admin',
      hierarchy_role: 'manager',
      isActive: true,
    }

    it('derives engineer role when adding user with engineer title', async () => {
      mockGetActor.mockResolvedValue(adminActor)
      mockRepo.createUser.mockResolvedValue({ error: null })

      const res = await addUser({
        email: 'dev@vsis.lk',
        password: 'ValidPassword123!',
        name: 'Dev User',
        department: 'Engineering',
        title: 'Systems Engineer',
        permissionRole: 'user',
        hierarchyRole: 'engineer',
        isActive: true,
      })

      expect(res).toEqual({})
      expect(mockRepo.createUser).toHaveBeenCalledWith(
        adminActor,
        expect.objectContaining({
          title: 'Systems Engineer',
          hierarchyRole: 'engineer',
        })
      )
    })

    it('rejects contradictory title and hierarchy role on user creation', async () => {
      mockGetActor.mockResolvedValue(adminActor)

      const res = await addUser({
        email: 'dev2@vsis.lk',
        password: 'ValidPassword123!',
        name: 'Dev User 2',
        department: 'Engineering',
        title: 'Systems Engineer', // Classified as 'engineer'
        permissionRole: 'user',
        hierarchyRole: 'manager', // Contradictory!
        isActive: true,
      })

      expect(res.error).toMatch(/Hierarchy role "manager" is inconsistent with the title "Systems Engineer"/)
      expect(mockRepo.createUser).not.toHaveBeenCalled()
    })

    it('rejects contradictory title and hierarchy role in updateUserHierarchy', async () => {
      mockGetActor.mockResolvedValue(adminActor)
      mockRepo.getProfileById.mockResolvedValue({
        id: 'u-1',
        title: 'Systems Engineer',
        hierarchy_role: 'engineer',
        permission_role: 'user',
      })

      const res = await updateUserHierarchy('u-1', {
        title: 'Systems Engineer',
        hierarchyRole: 'manager',
        managerId: null,
      })

      expect(res.error).toMatch(/Hierarchy role "manager" is inconsistent with the title "Systems Engineer"/)
      expect(mockRepo.updateUserHierarchy).not.toHaveBeenCalled()
    })

    it('assigns a managed title and synchronizes its hierarchy role', async () => {
      mockGetActor.mockResolvedValue(adminActor)
      mockRepo.getProfileById.mockResolvedValue({
        id: 'u-1',
        title: 'Intern',
        hierarchy_role: 'user',
        permission_role: 'user',
        manager_id: 'manager-1',
      })
      mockRepo.listProfiles.mockResolvedValue([
        { id: 'u-1', manager_id: 'manager-1' },
        { id: 'manager-1', manager_id: null },
      ])
      mockRepo.updateUserHierarchy.mockResolvedValue({ error: null })

      const res = await updateUserHierarchy('u-1', {
        title: 'Systems Engineer',
        managerId: 'manager-1',
      })

      expect(res).toEqual({})
      expect(mockRepo.updateUserHierarchy).toHaveBeenCalledWith(
        adminActor,
        'u-1',
        {
          title: 'Systems Engineer',
          hierarchyRole: 'engineer',
          managerId: 'manager-1',
        }
      )
    })
  })

  describe('Self-service Title Edits (updateMyProfile)', () => {
    const engineerActor: Actor = {
      id: 'eng-1',
      email: 'eng@vsis.lk',
      role: 'user',
      permission_role: 'user',
      hierarchy_role: 'engineer',
      isActive: true,
    }

    it('allows self-service title change within the same hierarchy role classification', async () => {
      mockGetActor.mockResolvedValue(engineerActor)
      mockRepo.updateMyProfile.mockResolvedValue({ error: null })

      const res = await updateMyProfile({
        department: 'Engineering',
        title: 'Senior Systems Engineer', // classified as 'engineer'
      })

      expect(res).toEqual({})
      expect(mockRepo.updateMyProfile).toHaveBeenCalledWith(
        engineerActor,
        {
          department: 'Engineering',
          title: 'Senior Systems Engineer',
        }
      )
    })

    it('rejects self-service title change to a different hierarchy classification (elevation attempt)', async () => {
      mockGetActor.mockResolvedValue(engineerActor)

      const res = await updateMyProfile({
        department: 'Engineering',
        title: 'Manager', // classified as 'manager'
      })

      expect(res.error).toMatch(/Cannot change to title "Manager" because it belongs to the "manager" hierarchy role/)
      expect(mockRepo.updateMyProfile).not.toHaveBeenCalled()
    })
  })

  describe('Title Administration & Reclassification', () => {
    const superAdminActor: Actor = {
      id: 'super-1',
      email: 'super@vsis.lk',
      role: 'admin',
      permission_role: 'admin',
      hierarchy_role: 'manager',
      isActive: true,
    }

    it('allows super-admin to add a title with classification', async () => {
      mockGetActor.mockResolvedValue(superAdminActor)
      mockRepo.addTitle.mockResolvedValue({ error: null })

      const res = await addTitle('DevOps Lead', 'team_lead')
      expect(res).toEqual({})
      expect(mockRepo.addTitle).toHaveBeenCalledWith(superAdminActor, 'DevOps Lead', 'team_lead')
    })

    it('allows super-admin to preview title impact', async () => {
      mockGetActor.mockResolvedValue(superAdminActor)
      mockRepo.getTitleImpact.mockResolvedValue({
        title: 'Systems Engineer',
        currentHierarchyRole: 'engineer',
        proposedHierarchyRole: 'manager',
        affectedCount: 5,
        syncRequired: true,
      })

      const res = await getTitleImpact('Systems Engineer', 'manager')
      expect(res).toEqual({
        title: 'Systems Engineer',
        currentHierarchyRole: 'engineer',
        proposedHierarchyRole: 'manager',
        affectedCount: 5,
        syncRequired: true,
      })
      expect(mockRepo.getTitleImpact).toHaveBeenCalledWith(superAdminActor, 'Systems Engineer', 'manager')
    })

    it('allows super-admin to reclassify title and reports affected users', async () => {
      mockGetActor.mockResolvedValue(superAdminActor)
      mockRepo.reclassifyTitle.mockResolvedValue({ error: null, affectedCount: 5 })

      const res = await reclassifyTitle('Systems Engineer', 'engineer', true)
      expect(res).toEqual({ affectedCount: 5 })
      expect(mockRepo.reclassifyTitle).toHaveBeenCalledWith(superAdminActor, 'Systems Engineer', 'engineer', true)
    })

    it('getTitleRecords returns full title metadata for authenticated users', async () => {
      mockGetActor.mockResolvedValue({
        id: 'u-1',
        email: 'u@vsis.lk',
        role: 'user',
        permission_role: 'user',
        hierarchy_role: 'user',
        isActive: true,
      })

      const res = await getTitleRecords()
      expect(res.titles).toEqual(sampleTitles)
      expect(res.error).toBeUndefined()
    })
  })
})
