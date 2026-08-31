// tests/action-policy.test.ts
// Comprehensive policy map and classification regression test for all 46 Server Actions.
// Ensures every exported action has an explicit security policy and enforces active-user / role gates.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  getActor: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    getBackfillWindow: vi.fn(),
    findTimesheetByUserDate: vi.fn(),
    createTimesheet: vi.fn(),
    updateTimesheet: vi.fn(),
    deleteTimesheet: vi.fn(),
    getTimesheet: vi.fn(),
    sumHoursForUserDate: vi.fn(),
    getTimesheetDailyTotals: vi.fn(),
    listProfiles: vi.fn(),
    getProfileById: vi.fn(),
    getProfileByEmail: vi.fn(),
    updateUserManager: vi.fn(),
    updateUserHierarchy: vi.fn(),
    setDashboardLayout: vi.fn(),
    setAdminLayout: vi.fn(),
    getDefaultLayouts: vi.fn(),
    setDefaultLayouts: vi.fn(),
    exportBackup: vi.fn(),
    restoreBackup: vi.fn(),
    resetTimesheets: vi.fn(),
    resetActivityData: vi.fn(),
    resetAllData: vi.fn(),
    deleteUser: vi.fn(),
    deleteActivityType: vi.fn(),
    deleteUserTimesheets: vi.fn(),
    listWhitelistedDomains: vi.fn(),
    addWhitelistedDomain: vi.fn(),
    updateWhitelistedDomain: vi.fn(),
    deleteWhitelistedDomain: vi.fn(),
    findWhitelistedDomain: vi.fn(),
    listTitles: vi.fn(),
    listTitleRecords: vi.fn(),
    addTitle: vi.fn(),
    getTitleImpact: vi.fn(),
    reclassifyTitle: vi.fn(),
    deleteTitle: vi.fn(),
    createProject: vi.fn(),
    renameProject: vi.fn(),
    setProjectSO: vi.fn(),
    setProjectTelegramNo: vi.fn(),
    deleteProject: vi.fn(),
    createActivityType: vi.fn(),
    renameActivityType: vi.fn(),
    setActivityTypeActive: vi.fn(),
    setActivityTypeTelegramNo: vi.fn(),
    createGlobalReminder: vi.fn(),
    deleteGlobalReminder: vi.fn(),
    dismissGlobalReminder: vi.fn(),
    setBackfillWindow: vi.fn(),
    importTimesheets: vi.fn(),
    listProjects: vi.fn(),
    listAllActivityTypes: vi.fn(),
    writeAuditLog: vi.fn(),
  },
}))

import * as actions from '../app/actions'
import { getActor } from '@/lib/auth'
import { repo } from '@/lib/db'

type Policy = 'active_user' | 'role_project_mgr' | 'role_admin' | 'super_admin'

/**
 * Security policy registry for all 51 Server Actions.
 * - active_user: Requires signed-in active account (any role)
 * - role_project_mgr: Requires signed-in active account with permission_role in ['admin', 'pm', 'co']
 * - role_admin: Requires signed-in active account with permission_role === 'admin'
 * - super_admin: Requires signed-in active account matching SUPER_ADMIN_EMAIL with admin role
 */
export const ACTION_POLICIES: Record<keyof typeof actions, Policy> = {
  // Timesheet & User Entries (Active User)
  logEntry: 'active_user',
  duplicateEntry: 'active_user',
  logYesterday: 'active_user',
  deleteLastEntry: 'active_user',
  updateTimesheet: 'active_user',
  deleteTimesheet: 'active_user',
  bulkUpdateTimesheets: 'active_user',
  updateMyProfile: 'active_user',
  dismissGlobalReminder: 'active_user',
  saveDashboardLayout: 'active_user',
  getDefaultLayouts: 'active_user',
  amISuperAdmin: 'active_user',
  getTitles: 'active_user',
  getTitleRecords: 'active_user',
  getBranding: 'active_user',

  // Project Management (Admin / PM / CO)
  addProject: 'role_project_mgr',
  renameProject: 'role_project_mgr',
  setProjectSO: 'role_project_mgr',
  setProjectTelegramNo: 'role_project_mgr',

  // Admin Management (Admin only)
  deleteProject: 'role_admin',
  addUser: 'role_admin',
  toggleUserStatus: 'role_admin',
  updateUserRoles: 'role_admin',
  updateUserName: 'role_admin',
  setUserManager: 'role_admin',
  addActivityType: 'role_admin',
  renameActivityType: 'role_admin',
  setActivityTypeActive: 'role_admin',
  setActivityTypeTelegramNo: 'role_admin',
  addGlobalReminder: 'role_admin',
  deleteGlobalReminder: 'role_admin',
  setBackfillWindow: 'role_admin',
  saveAdminLayout: 'role_admin',
  deleteUserTimesheets: 'role_admin',
  updateUserHierarchy: 'role_admin',
  exportBackup: 'role_admin',
  restoreBackup: 'role_admin',
  importTimesheets: 'role_admin',

  // Super Admin Operations
  saveBranding: 'super_admin',
  resetBranding: 'super_admin',
  setDefaultLayouts: 'super_admin',
  resetDatabase: 'super_admin',
  deleteUser: 'super_admin',
  deleteActivityType: 'super_admin',
  getWhitelistedDomains: 'super_admin',
  addWhitelistedDomain: 'super_admin',
  toggleDomainAutoActivate: 'super_admin',
  deleteWhitelistedDomain: 'super_admin',
  addTitle: 'super_admin',
  getTitleImpact: 'super_admin',
  reclassifyTitle: 'super_admin',
  deleteTitle: 'super_admin',
}

const mockGetActor = vi.mocked(getActor)
const mockRepo = repo as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('Server Action Security Policy Map', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPER_ADMIN_EMAIL = 'super@vsis.lk'
    for (const fn of Object.values(mockRepo)) {
      if (typeof fn === 'function' && 'mockResolvedValue' in fn) {
        fn.mockResolvedValue({ error: null })
      }
    }
  })

  it('classifies exactly every exported server action (no omissions)', () => {
    const exportedNames = Object.keys(actions).sort()
    const policyNames = Object.keys(ACTION_POLICIES).sort()

    expect(exportedNames).toEqual(policyNames)
    expect(exportedNames.length).toBe(52)
  })

  describe('Active User Gate: Rejection of Inactive Accounts', () => {
    const inactiveUser = {
      id: 'inactive-1',
      email: 'inactive@vsis.lk',
      role: 'user' as const,
      permission_role: 'user' as const,
      hierarchy_role: 'user' as const,
      isActive: false,
    }

    const inactiveAdmin = {
      id: 'inactive-admin',
      email: 'super@vsis.lk',
      role: 'admin' as const,
      permission_role: 'admin' as const,
      hierarchy_role: 'manager' as const,
      isActive: false,
    }

    it('rejects inactive user for getTitles', async () => {
      mockGetActor.mockResolvedValue(inactiveUser)
      const res = await actions.getTitles()
      expect(res).toEqual({ titles: [], error: 'Your account is not active.' })
    })

    it('rejects inactive user for getDefaultLayouts', async () => {
      mockGetActor.mockResolvedValue(inactiveUser)
      const res = await actions.getDefaultLayouts()
      expect(res).toEqual({ error: 'Your account is not active.' })
    })

    it('rejects inactive user for dismissGlobalReminder', async () => {
      mockGetActor.mockResolvedValue(inactiveUser)
      const res = await actions.dismissGlobalReminder('rem-1')
      expect(res).toEqual({ error: 'Your account is not active.' })
    })

    it('rejects inactive admin for admin actions', async () => {
      mockGetActor.mockResolvedValue(inactiveAdmin)
      const res = await actions.deleteProject('proj-1')
      expect(res).toEqual({ error: 'Your account is not active.' })
    })

    it('rejects inactive super-admin for super-admin actions', async () => {
      mockGetActor.mockResolvedValue(inactiveAdmin)
      const res = await actions.resetDatabase('timesheets')
      expect(res).toEqual({ error: 'You do not have permission to perform this action.' })
    })

    it('returns isSuperAdmin=false for inactive super-admin', async () => {
      mockGetActor.mockResolvedValue(inactiveAdmin)
      const res = await actions.amISuperAdmin()
      expect(res).toEqual({ isSuperAdmin: false })
    })
  })

  describe('Unauthenticated Gate', () => {
    it('rejects unauthenticated caller for getTitles', async () => {
      mockGetActor.mockResolvedValue(null)
      const res = await actions.getTitles()
      expect(res).toEqual({ titles: [], error: 'You must be signed in.' })
    })

    it('returns isSuperAdmin=false when signed out', async () => {
      mockGetActor.mockResolvedValue(null)
      const res = await actions.amISuperAdmin()
      expect(res).toEqual({ isSuperAdmin: false })
    })
  })
})
