import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addTitle,
  addWhitelistedDomain,
  createActivityType,
  createProject,
  deleteActivityType,
  deleteProject,
  deleteTitle,
  deleteWhitelistedDomain,
  getTitleImpact,
  listActivityTypes,
  listActivityTypesForAdmin,
  listProjects,
  listProjectsForAdmin,
  listTitleRecords,
  listTitles,
  listWhitelistedDomains,
  reclassifyTitle,
  renameActivityType,
  renameProject,
  setActivityTypeActive,
  setActivityTypeTelegramNo,
  setProjectSO,
  setProjectTelegramNo,
  updateWhitelistedDomain,
  updateActivityType,
  updateProject,
  ACTIVITY_TYPE_NAME_REQUIRED,
  INVALID_HIERARCHY_ROLE,
  INVALID_PROPOSED_HIERARCHY_ROLE,
  INVALID_TELEGRAM_NO,
  PROJECT_NAME_REQUIRED,
  PROJECT_NOT_FOUND,
  TITLE_NAME_REQUIRED,
  type ReferenceDomainDeps,
} from '@/lib/domain/reference'
import type { ReferencePersistence } from '@/lib/domain/reference-port'
import type { Actor } from '@/lib/db/repository'

// Mock persistence for the reference-data port. Each backend implements this
// surface over its own provider; here we assert the application module's policy
// and orchestration in isolation.
function createPersistence(): { [K in keyof ReferencePersistence]: ReturnType<typeof vi.fn> } {
  return {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    renameProject: vi.fn(),
    setProjectSO: vi.fn(),
    setProjectTelegramNo: vi.fn(),
    deleteProject: vi.fn(),
    listActivityTypes: vi.fn(),
    listAllActivityTypes: vi.fn(),
    createActivityType: vi.fn(),
    renameActivityType: vi.fn(),
    setActivityTypeActive: vi.fn(),
    setActivityTypeTelegramNo: vi.fn(),
    deleteActivityType: vi.fn(),
    listTitles: vi.fn(),
    listTitleRecords: vi.fn(),
    addTitle: vi.fn(),
    deleteTitle: vi.fn(),
    reclassifyTitle: vi.fn(),
    getTitleImpact: vi.fn(),
    listWhitelistedDomains: vi.fn(),
    addWhitelistedDomain: vi.fn(),
    updateWhitelistedDomain: vi.fn(),
    deleteWhitelistedDomain: vi.fn(),
  }
}

const admin: Actor = {
  id: 'admin-1',
  email: 'admin@vsis.lk',
  role: 'admin',
  permission_role: 'admin',
  hierarchy_role: 'manager',
  isActive: true,
}

const pm: Actor = {
  id: 'pm-1',
  email: 'pm@vsis.lk',
  role: 'pm',
  permission_role: 'pm',
  hierarchy_role: 'user',
  isActive: true,
}

const regularUser: Actor = {
  id: 'user-1',
  email: 'user@vsis.lk',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'engineer',
  isActive: true,
}

const superAdmin: Actor = { ...admin, email: 'super@vsis.lk' }

const inactiveAdmin: Actor = { ...admin, isActive: false }

const projectRow = { id: 'p1', name: 'Alpha', so_number: null, telegram_no: null, created_at: '' }
const activityRow = { id: 'a1', name: 'Coding', is_active: true, telegram_no: null, created_at: '' }
const titleRow = { id: 't1', name: 'Manager', hierarchy_role: 'manager' as const, created_at: '' }

describe('Reference domain service', () => {
  let persistence: ReturnType<typeof createPersistence>
  let deps: ReferenceDomainDeps

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPER_ADMIN_EMAIL = 'super@vsis.lk'
    persistence = createPersistence()
    deps = { persistence: persistence as unknown as ReferencePersistence }
    persistence.listProjects.mockResolvedValue([])
    persistence.listActivityTypes.mockResolvedValue([])
    persistence.listTitleRecords.mockResolvedValue([])
    persistence.listTitles.mockResolvedValue([])
    persistence.renameProject.mockResolvedValue({ error: null })
    persistence.setProjectSO.mockResolvedValue({ error: null })
    persistence.setProjectTelegramNo.mockResolvedValue({ error: null })
    persistence.deleteProject.mockResolvedValue({ error: null })
    persistence.renameActivityType.mockResolvedValue({ error: null })
    persistence.setActivityTypeActive.mockResolvedValue({ error: null })
    persistence.setActivityTypeTelegramNo.mockResolvedValue({ error: null })
    persistence.deleteActivityType.mockResolvedValue({ error: null })
    persistence.addTitle.mockResolvedValue({ data: titleRow, error: null })
    persistence.deleteTitle.mockResolvedValue({ error: null })
    persistence.reclassifyTitle.mockResolvedValue({ error: null, affectedCount: 2 })
    persistence.getTitleImpact.mockResolvedValue({
      title: 'Manager',
      currentHierarchyRole: 'manager',
      proposedHierarchyRole: 'team_lead',
      affectedCount: 2,
      syncRequired: true,
    })
    persistence.listWhitelistedDomains.mockResolvedValue([])
    persistence.addWhitelistedDomain.mockResolvedValue({ error: null })
    persistence.updateWhitelistedDomain.mockResolvedValue({ error: null })
    persistence.deleteWhitelistedDomain.mockResolvedValue({ error: null })
  })

  describe('projects', () => {
    it('allows admin/pm to create and returns the inserted row atomically', async () => {
      persistence.createProject.mockResolvedValue({ data: projectRow, error: null })
      const result = await createProject(pm, { name: 'Alpha' }, deps)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data).toEqual(projectRow)
      expect(persistence.createProject).toHaveBeenCalledWith(pm, 'Alpha')
    })

    it('denies a regular user creating a project (allow and deny)', async () => {
      const result = await createProject(regularUser, { name: 'Alpha' }, deps)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
      expect(persistence.createProject).not.toHaveBeenCalled()
    })

    it('validates the name and telegram number before writing', async () => {
      const empty = await createProject(admin, { name: '   ' }, deps)
      expect(empty.ok).toBe(false)
      if (!empty.ok) expect(empty.error.message).toBe(PROJECT_NAME_REQUIRED)

      const badTelegram = await createProject(admin, { name: 'Alpha', telegramNo: 0 }, deps)
      expect(badTelegram.ok).toBe(false)
      if (!badTelegram.ok) expect(badTelegram.error.message).toBe(INVALID_TELEGRAM_NO)
      expect(persistence.createProject).not.toHaveBeenCalled()
    })

    it('maps a duplicate-name provider error to a conflict', async () => {
      persistence.createProject.mockResolvedValue({
        data: null,
        error: 'A record with that value already exists.',
      })
      const result = await createProject(admin, { name: 'Alpha' }, deps)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('CONFLICT')
    })

    it('gates the admin list on admin/pm', async () => {
      const allowed = await listProjectsForAdmin(pm, deps)
      expect(allowed.ok).toBe(true)

      const denied = await listProjectsForAdmin(regularUser, deps)
      expect(denied.ok).toBe(false)
      if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')
    })

    it('reads the plain project list without a role gate', async () => {
      persistence.listProjects.mockResolvedValue([projectRow])
      const result = await listProjects(regularUser, deps)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data).toEqual([projectRow])
    })

    it('applies a partial update in order and reads the row back', async () => {
      persistence.listProjects.mockResolvedValue([{ ...projectRow, name: 'Renamed' }])
      const result = await updateProject(
        admin,
        'p1',
        { name: 'Renamed', soNumber: 'SO-1' },
        deps
      )
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.name).toBe('Renamed')
      expect(persistence.renameProject).toHaveBeenCalledWith(admin, 'p1', 'Renamed')
      expect(persistence.setProjectSO).toHaveBeenCalledWith(admin, 'p1', 'SO-1')
    })

    it('reports NOT_FOUND when the row disappears on read-back', async () => {
      persistence.listProjects.mockResolvedValue([])
      const result = await updateProject(admin, 'gone', { name: 'Renamed' }, deps)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.message).toBe(PROJECT_NOT_FOUND)
    })

    it('deletes only for admin/pm and surfaces the provider error', async () => {
      persistence.deleteProject.mockResolvedValue({ error: 'Cannot delete: referenced.' })
      const denied = await deleteProject(regularUser, 'p1', deps)
      expect(denied.ok).toBe(false)
      if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')

      const result = await deleteProject(admin, 'p1', deps)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('CONFLICT')
    })

    it('supports rename/set SO/set telegram helpers', async () => {
      expect((await renameProject(admin, 'p1', 'Beta', deps)).ok).toBe(true)
      expect((await setProjectSO(admin, 'p1', '  SO-9 ', deps)).ok).toBe(true)
      expect(persistence.setProjectSO).toHaveBeenCalledWith(admin, 'p1', 'SO-9')
      expect((await setProjectTelegramNo(admin, 'p1', 7, deps)).ok).toBe(true)
      expect(persistence.setProjectTelegramNo).toHaveBeenCalledWith(admin, 'p1', 7)
    })
  })

  describe('activity types', () => {
    it('allows only admins and returns the inserted row', async () => {
      persistence.createActivityType.mockResolvedValue({ data: activityRow, error: null })
      const denied = await createActivityType(pm, { name: 'Coding' }, deps)
      expect(denied.ok).toBe(false)
      if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')

      const allowed = await createActivityType(admin, { name: '  Coding ' }, deps)
      expect(allowed.ok).toBe(true)
      if (allowed.ok) expect(allowed.data).toEqual(activityRow)
      expect(persistence.createActivityType).toHaveBeenCalledWith(admin, 'Coding')
    })

    it('validates the name and telegram number', async () => {
      const empty = await createActivityType(admin, { name: '' }, deps)
      expect(empty.ok).toBe(false)
      if (!empty.ok) expect(empty.error.message).toBe(ACTIVITY_TYPE_NAME_REQUIRED)

      const bad = await createActivityType(admin, { name: 'Coding', telegramNo: -1 }, deps)
      expect(bad.ok).toBe(false)
      if (!bad.ok) expect(bad.error.message).toBe(INVALID_TELEGRAM_NO)
    })

    it('gates the admin list on admin only', async () => {
      const denied = await listActivityTypesForAdmin(pm, deps)
      expect(denied.ok).toBe(false)
      if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')
      const allowed = await listActivityTypesForAdmin(admin, deps)
      expect(allowed.ok).toBe(true)
    })

    it('reads the plain list without a role gate', async () => {
      const result = await listActivityTypes(regularUser, deps)
      expect(result.ok).toBe(true)
    })

    it('updates fields in order and reads back', async () => {
      persistence.listActivityTypes.mockResolvedValue([{ ...activityRow, is_active: false }])
      const result = await updateActivityType(admin, 'a1', { isActive: false }, deps)
      expect(result.ok).toBe(true)
      expect(persistence.setActivityTypeActive).toHaveBeenCalledWith(admin, 'a1', false)
    })

    it('deletes only for admins', async () => {
      const denied = await deleteActivityType(pm, 'a1', deps)
      expect(denied.ok).toBe(false)
      const allowed = await deleteActivityType(admin, 'a1', deps)
      expect(allowed.ok).toBe(true)
      expect(persistence.deleteActivityType).toHaveBeenCalledWith(admin, 'a1')
    })

    it('supports rename/set active/set telegram helpers', async () => {
      expect((await renameActivityType(admin, 'a1', 'Dev', deps)).ok).toBe(true)
      expect((await setActivityTypeActive(admin, 'a1', false, deps)).ok).toBe(true)
      expect((await setActivityTypeTelegramNo(admin, 'a1', 3, deps)).ok).toBe(true)
      expect(persistence.setActivityTypeTelegramNo).toHaveBeenCalledWith(admin, 'a1', 3)
    })
  })

  describe('titles', () => {
    it('allows only the configured super-admin to add a title and returns the row', async () => {
      const denied = await addTitle(admin, 'Manager', 'manager', deps)
      expect(denied.ok).toBe(false)
      if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')

      const allowed = await addTitle(superAdmin, ' Manager ', 'manager', deps)
      expect(allowed.ok).toBe(true)
      if (allowed.ok) expect(allowed.data).toEqual(titleRow)
      expect(persistence.addTitle).toHaveBeenCalledWith(superAdmin, 'Manager', 'manager')
    })

    it('validates the title name and hierarchy role', async () => {
      const empty = await addTitle(superAdmin, '   ', 'manager', deps)
      expect(empty.ok).toBe(false)
      if (!empty.ok) expect(empty.error.message).toBe(TITLE_NAME_REQUIRED)

      const badRole = await addTitle(superAdmin, 'Manager', 'bogus' as never, deps)
      expect(badRole.ok).toBe(false)
      if (!badRole.ok) expect(badRole.error.message).toBe(INVALID_HIERARCHY_ROLE)
    })

    it('lists titles and title records for any active actor', async () => {
      persistence.listTitles.mockResolvedValue(['Manager'])
      persistence.listTitleRecords.mockResolvedValue([titleRow])
      const titles = await listTitles(regularUser, deps)
      expect(titles.ok).toBe(true)
      if (titles.ok) expect(titles.data).toEqual(['Manager'])
      const records = await listTitleRecords(regularUser, deps)
      expect(records.ok).toBe(true)
      if (records.ok) expect(records.data).toEqual([titleRow])
    })

    it('reclassifies a title for the super-admin and reports affected count', async () => {
      const result = await reclassifyTitle(superAdmin, 'Manager', 'team_lead', true, deps)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.affectedCount).toBe(2)
      expect(persistence.reclassifyTitle).toHaveBeenCalledWith(superAdmin, 'Manager', 'team_lead', true)
    })

    it('denies reclassification for a non-super-admin', async () => {
      const result = await reclassifyTitle(admin, 'Manager', 'team_lead', false, deps)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
    })

    it('previews title impact and validates the proposed role', async () => {
      const result = await getTitleImpact(superAdmin, 'Manager', 'team_lead', deps)
      expect(result.ok).toBe(true)

      const badRole = await getTitleImpact(superAdmin, 'Manager', 'bogus' as never, deps)
      expect(badRole.ok).toBe(false)
      if (!badRole.ok) expect(badRole.error.message).toBe(INVALID_PROPOSED_HIERARCHY_ROLE)
    })

    it('deletes a title for the super-admin only', async () => {
      const denied = await deleteTitle(admin, 'Manager', deps)
      expect(denied.ok).toBe(false)
      const allowed = await deleteTitle(superAdmin, ' Manager ', deps)
      expect(allowed.ok).toBe(true)
      expect(persistence.deleteTitle).toHaveBeenCalledWith(superAdmin, 'Manager')
    })
  })

  describe('email domain whitelist', () => {
    const domain = {
      id: 'd1',
      domain: 'vsis.lk',
      auto_activate: true,
      created_at: '',
    }

    it('gates reads and normalizes writes to the configured super-admin', async () => {
      const denied = await listWhitelistedDomains(admin, deps)
      expect(denied.ok).toBe(false)
      if (!denied.ok) expect(denied.error.message).toBe('Super-admin access required.')

      persistence.listWhitelistedDomains.mockResolvedValue([domain])
      const listed = await listWhitelistedDomains(superAdmin, deps)
      expect(listed.ok).toBe(true)
      if (listed.ok) expect(listed.data).toEqual([domain])

      const added = await addWhitelistedDomain(superAdmin, ' @Example.COM ', true, deps)
      expect(added).toEqual({ ok: true, data: { domain: 'example.com' } })
      expect(persistence.addWhitelistedDomain).toHaveBeenCalledWith(superAdmin, 'example.com', true)
    })

    it('validates and propagates whitelist persistence failures', async () => {
      const invalid = await addWhitelistedDomain(superAdmin, 'not-a-domain', false, deps)
      expect(invalid.ok).toBe(false)
      if (!invalid.ok) expect(invalid.error.message).toBe('Please enter a valid domain (e.g. company.com).')
      expect(persistence.addWhitelistedDomain).not.toHaveBeenCalled()

      persistence.addWhitelistedDomain.mockResolvedValue({ error: 'Domain already exists.' })
      const failed = await addWhitelistedDomain(superAdmin, 'example.com', false, deps)
      expect(failed.ok).toBe(false)
      if (!failed.ok) expect(failed.error.code).toBe('STORAGE_ERROR')

      expect((await updateWhitelistedDomain(superAdmin, 'd1', false, deps)).ok).toBe(true)
      expect((await deleteWhitelistedDomain(superAdmin, 'd1', deps)).ok).toBe(true)
    })
  })

  describe('inactive actors', () => {
    it('rejects every operation class for an inactive account', async () => {
      for (const result of [
        await listProjects(inactiveAdmin, deps),
        await createProject(inactiveAdmin, { name: 'Alpha' }, deps),
        await listActivityTypes(inactiveAdmin, deps),
        await createActivityType(inactiveAdmin, { name: 'Coding' }, deps),
        await listTitles(inactiveAdmin, deps),
        await addTitle(inactiveAdmin, 'Manager', 'manager', deps),
      ]) {
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
      }
    })
  })
})
