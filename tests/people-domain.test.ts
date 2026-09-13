// tests/people-domain.test.ts
// Focused coverage for Slice 05: the people application service and its narrow
// ports. Exercises the shared rules (both role axes, capability/hierarchy),
// manager/team-lead visibility, self-versus-other access, admin create/update
// allow/deny, and the provider-identity separation.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/app/types'

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    getProfileById: vi.fn(),
    listProfiles: vi.fn(),
    updateUserStatus: vi.fn(),
    updateUserRoles: vi.fn(),
    updateMyProfile: vi.fn(),
    updateUserName: vi.fn(),
    updateUserManager: vi.fn(),
    updateUser: vi.fn(),
    updateUserHierarchy: vi.fn(),
    listTitleRecords: vi.fn(),
    writeAuditLog: vi.fn(),
    createUser: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ repo: mockRepo }))

import {
  buildHierarchyTree,
  canViewTeamActor,
  createPersonDomain,
  getActorCapabilities,
  getSelfProfileDomain,
  legacyRoleFromPair,
  listPeopleDomain,
  rolePairFromLegacy,
  setPersonManagerDomain,
  togglePersonStatusDomain,
  updatePersonDomain,
  updatePersonHierarchyDomain,
} from '@/lib/domain/people'
import { peopleDeps, peopleIdentity, peoplePersistence } from '@/lib/db/people'
import { canViewTeamActor as rolesCanViewTeam, getActorCapabilities as rolesCapabilities } from '@/lib/roles'
import { buildHierarchyTree as hierarchyBuildTree } from '@/lib/hierarchy'
import type { Actor as RepositoryActor } from '@/lib/db/repository'

type MockedActor = RepositoryActor

const admin: MockedActor = {
  id: 'admin-1',
  email: 'admin@vsis.lk',
  role: 'admin',
  permission_role: 'admin',
  hierarchy_role: 'manager',
  isActive: true,
}

const manager: MockedActor = {
  id: 'mgr-1',
  email: 'lead@vsis.lk',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'manager',
  isActive: true,
}

const pm: MockedActor = {
  id: 'pm-1',
  email: 'pm@vsis.lk',
  role: 'pm',
  permission_role: 'pm',
  hierarchy_role: 'user',
  isActive: true,
}

const engineer: MockedActor = {
  id: 'eng-1',
  email: 'eng@vsis.lk',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'engineer',
  isActive: true,
}

function profile(id: string, overrides: Partial<User> = {}): User {
  return {
    id,
    email: `${id}@vsis.lk`,
    name: id,
    department: '',
    title: '',
    role: 'user',
    permission_role: 'user',
    hierarchy_role: 'user',
    is_active: true,
    manager_id: null,
    dashboard_layout: null,
    admin_layout: null,
    mobile_layout: null,
    created_at: '',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of Object.values(mockRepo)) fn.mockResolvedValue({ error: null })
  mockRepo.listTitleRecords.mockResolvedValue([
    { id: 't1', name: 'Systems Engineer', hierarchy_role: 'engineer', created_at: '' },
    { id: 't2', name: 'Manager', hierarchy_role: 'manager', created_at: '' },
  ])
})

describe('platform-neutral rules exposed by the service', () => {
  it('re-exports the canonical capability and hierarchy calculations', () => {
    // Same predicate as lib/roles.ts — capability and hierarchy stay on one axis each.
    expect(canViewTeamActor).toBe(rolesCanViewTeam)
    expect(getActorCapabilities).toBe(rolesCapabilities)
    expect(buildHierarchyTree).toBe(hierarchyBuildTree)

    expect(getActorCapabilities(admin).canManageUsers).toBe(true)
    expect(getActorCapabilities(pm).canManageUsers).toBe(false)
    expect(getActorCapabilities(manager).canViewTeam).toBe(true)
    expect(canViewTeamActor(engineer)).toBe(false)
  })

  it('keeps permission_role and hierarchy_role independent through the legacy mapping', () => {
    // A permission role never changes the hierarchy axis and vice versa.
    expect(rolePairFromLegacy('admin')).toEqual({ permission: 'admin', hierarchy: 'user' })
    expect(rolePairFromLegacy('manager')).toEqual({ permission: 'user', hierarchy: 'manager' })
    expect(legacyRoleFromPair('admin', 'engineer')).toBe('admin')
    expect(legacyRoleFromPair('user', 'engineer')).toBe('user')
    expect(legacyRoleFromPair('user', 'team_lead')).toBe('team_lead')
  })
})

describe('people ports and provider-identity separation', () => {
  it('does not leak credential creation into the persistence port', () => {
    const keys = Object.keys(peoplePersistence)
    expect(keys).not.toContain('createUser')
    expect(keys).not.toContain('createAccount')
    expect(keys).not.toContain('password')
    expect(keys).toContain('getProfileById')
    expect(keys).toContain('updateUserHierarchy')
  })

  it('routes account provisioning through the identity boundary', async () => {
    const input = {
      email: 'new@vsis.lk',
      password: 'Secret1pass',
      name: 'New',
      department: 'Eng',
      title: 'Systems Engineer',
      permissionRole: 'user' as const,
      hierarchyRole: 'engineer' as const,
      isActive: true,
      managerId: null,
    }
    await peopleIdentity.createAccount(admin, input)
    expect(mockRepo.createUser).toHaveBeenCalledWith(admin, input)
  })
})

describe('listPeopleDomain visibility', () => {
  it('lets a manager list their scoped profiles', async () => {
    mockRepo.listProfiles.mockResolvedValue([profile('emp-1', { manager_id: 'mgr-1' })])
    const result = await listPeopleDomain(manager, peopleDeps())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toHaveLength(1)
    expect(mockRepo.listProfiles).toHaveBeenCalledWith(manager)
  })

  it('rejects a pure PM (no leadership hierarchy) and a regular engineer', async () => {
    const pmResult = await listPeopleDomain(pm, peopleDeps())
    expect(pmResult.ok).toBe(false)
    if (!pmResult.ok) expect(pmResult.error.code).toBe('FORBIDDEN')

    const engResult = await listPeopleDomain(engineer, peopleDeps())
    expect(engResult.ok).toBe(false)

    expect(mockRepo.listProfiles).not.toHaveBeenCalled()
  })

  it('reads the self profile by actor id', async () => {
    mockRepo.getProfileById.mockResolvedValue(profile('eng-1'))
    const result = await getSelfProfileDomain(engineer, peopleDeps())
    expect(result.ok).toBe(true)
    expect(mockRepo.getProfileById).toHaveBeenCalledWith('eng-1')
  })
})

describe('createPersonDomain', () => {
  const base = {
    email: ' New@VSIS.lk ',
    password: 'Secret1pass',
    name: ' New ',
    department: ' Eng ',
    title: 'Systems Engineer',
    permissionRole: 'user' as const,
    hierarchyRole: 'engineer' as const,
    isActive: true,
  }

  it('derives the hierarchy role from the title and normalizes identity input', async () => {
    const result = await createPersonDomain(admin, base, peopleDeps())
    expect(result.ok).toBe(true)
    expect(mockRepo.createUser).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        email: 'new@vsis.lk',
        name: 'New',
        department: 'Eng',
        hierarchyRole: 'engineer',
        permissionRole: 'user',
      })
    )
    // Permission axis is never derived from the title.
    expect(mockRepo.createUser).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ permissionRole: 'user' })
    )
  })

  it('rejects a title/hierarchy-role contradiction before touching the identity boundary', async () => {
    const result = await createPersonDomain(admin, { ...base, hierarchyRole: 'manager' }, peopleDeps())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
      expect(result.error.message).toContain('is inconsistent with the title')
    }
    expect(mockRepo.createUser).not.toHaveBeenCalled()
  })

  it('rejects invalid enums, weak passwords and bad emails without provisioning', async () => {
    expect((await createPersonDomain(admin, { ...base, permissionRole: 'bogus' as never }, peopleDeps())).ok).toBe(false)
    expect((await createPersonDomain(admin, { ...base, hierarchyRole: 'bogus' as never }, peopleDeps())).ok).toBe(false)
    expect((await createPersonDomain(admin, { ...base, password: 'short' }, peopleDeps())).ok).toBe(false)
    expect((await createPersonDomain(admin, { ...base, email: 'not-an-email' }, peopleDeps())).ok).toBe(false)
    expect(mockRepo.createUser).not.toHaveBeenCalled()
  })

  it('rejects a non-admin provisioning attempt', async () => {
    const result = await createPersonDomain(manager, base, peopleDeps())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
    expect(mockRepo.createUser).not.toHaveBeenCalled()
  })
})

describe('self-versus-other access in account administration', () => {
  it('blocks self-deactivation', async () => {
    mockRepo.getProfileById.mockResolvedValue(profile('admin-1', { is_active: true }))
    const result = await togglePersonStatusDomain(admin, 'admin-1', peopleDeps())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe('You cannot deactivate your own account.')
    expect(mockRepo.updateUserStatus).not.toHaveBeenCalled()
  })

  it('toggles another user and audits the change', async () => {
    mockRepo.getProfileById.mockResolvedValue(profile('u2', { is_active: false }))
    const result = await togglePersonStatusDomain(admin, 'u2', peopleDeps())
    expect(result.ok).toBe(true)
    expect(mockRepo.updateUserStatus).toHaveBeenCalledWith(admin, 'u2', true)
    expect(mockRepo.writeAuditLog).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ action: 'user.status_change', targetId: 'u2' })
    )
  })

  it('blocks self-reporting and reporting cycles', async () => {
    const selfReport = await setPersonManagerDomain(admin, 'u2', 'u2', peopleDeps())
    expect(selfReport.ok).toBe(false)
    if (!selfReport.ok) expect(selfReport.error.message).toBe('A user cannot report to themselves.')

    mockRepo.listProfiles.mockResolvedValue([
      profile('A', { manager_id: 'B' }),
      profile('B', { manager_id: 'A' }),
    ])
    const cycle = await setPersonManagerDomain(admin, 'A', 'B', peopleDeps())
    expect(cycle.ok).toBe(false)
    if (!cycle.ok) expect(cycle.error.message).toContain('reporting cycle')
    expect(mockRepo.updateUserManager).not.toHaveBeenCalled()
  })
})

describe('updatePersonDomain (atomic admin update)', () => {
  it('rejects self-deactivation and a contradictory title/hierarchy pair', async () => {
    mockRepo.getProfileById.mockResolvedValueOnce(profile('admin-1', { is_active: true }))
    const deact = await updatePersonDomain(admin, 'admin-1', { isActive: false }, peopleDeps())
    expect(deact.ok).toBe(false)
    if (!deact.ok) expect(deact.error.message).toBe('You cannot deactivate your own account.')

    mockRepo.getProfileById.mockResolvedValueOnce(
      profile('u2', { title: 'Intern', hierarchy_role: 'user' })
    )
    const contradiction = await updatePersonDomain(
      admin,
      'u2',
      { title: 'Intern', hierarchyRole: 'manager' },
      peopleDeps()
    )
    expect(contradiction.ok).toBe(false)
    if (!contradiction.ok) expect(contradiction.error.message).toContain('is inconsistent with the title')
    expect(mockRepo.updateUser).not.toHaveBeenCalled()
  })

  it('validates the selected manager is active and a leader', async () => {
    mockRepo.getProfileById
      .mockResolvedValueOnce(profile('u2'))
      .mockResolvedValueOnce(profile('m1', { is_active: true, hierarchy_role: 'engineer' }))
    const result = await updatePersonDomain(admin, 'u2', { managerId: 'm1' }, peopleDeps())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('leadership hierarchy role')
    expect(mockRepo.updateUser).not.toHaveBeenCalled()
  })

  it('applies the atomic update and returns the re-read profile', async () => {
    mockRepo.getProfileById
      .mockResolvedValueOnce(profile('u2', { title: 'Intern', hierarchy_role: 'user' }))
      .mockResolvedValueOnce(profile('m1', { is_active: true, hierarchy_role: 'manager' }))
      .mockResolvedValueOnce(profile('u2', { name: 'New Name', hierarchy_role: 'engineer' }))
    mockRepo.listProfiles.mockResolvedValue([profile('u2'), profile('m1')])

    const result = await updatePersonDomain(
      admin,
      'u2',
      { name: 'New Name', title: 'Systems Engineer', managerId: 'm1' },
      peopleDeps()
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data?.name).toBe('New Name')
    expect(mockRepo.updateUser).toHaveBeenCalledWith(
      admin,
      'u2',
      expect.objectContaining({ name: 'New Name', title: 'Systems Engineer', hierarchyRole: 'engineer', managerId: 'm1' })
    )
  })
})

describe('updatePersonHierarchyDomain (hierarchy axis only)', () => {
  it('rejects a contradictory hierarchy-role save and never touches the permission axis', async () => {
    mockRepo.getProfileById.mockResolvedValue(profile('u2', { title: 'Systems Engineer', hierarchy_role: 'engineer' }))
    const result = await updatePersonHierarchyDomain(
      admin,
      'u2',
      { managerId: null, hierarchyRole: 'manager' },
      peopleDeps()
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('is inconsistent with the title')
    expect(mockRepo.updateUserHierarchy).not.toHaveBeenCalled()
  })

  it('syncs the hierarchy role from a managed title', async () => {
    mockRepo.getProfileById.mockResolvedValue(profile('u2', { title: 'Intern', hierarchy_role: 'user', manager_id: 'm1' }))
    mockRepo.listProfiles.mockResolvedValue([profile('u2'), profile('m1')])
    const result = await updatePersonHierarchyDomain(
      admin,
      'u2',
      { managerId: 'm1', title: 'Systems Engineer' },
      peopleDeps()
    )
    expect(result.ok).toBe(true)
    expect(mockRepo.updateUserHierarchy).toHaveBeenCalledWith(admin, 'u2', {
      managerId: 'm1',
      title: 'Systems Engineer',
      hierarchyRole: 'engineer',
    })
  })
})
