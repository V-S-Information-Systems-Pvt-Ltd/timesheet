// tests/domain-adapter-contracts.test.ts
//
// Contract test suite verifying that the native domain adapters
// export objects matching the complete domain persistence interface contracts.

import { describe, expect, it } from 'vitest'

import { nativeTimesheetPersistence } from '../lib/db/native/timesheets'
import { nativeReferencePersistence } from '../lib/db/native/reference'
import {
  nativePeopleIdentity,
  nativePeoplePersistence,
} from '../lib/db/native/people'
import { createNativeReportingPersistence } from '../lib/db/native/reporting'
import { nativeLeaveReminderPersistence } from '../lib/db/native/leave-reminders'
import { nativeWorkspacePersistence } from '../lib/db/native/workspace'
import { nativeOperationsPersistence } from '../lib/db/native/operations'

const nativeReportingPersistence = createNativeReportingPersistence((actor, opts) => nativeTimesheetPersistence.list(actor, opts))

function extractMethodNames(obj: Record<string, unknown>): string[] {
  return Object.keys(obj)
    .filter((key) => typeof obj[key] === 'function')
    .sort()
}

describe('domain adapter contracts', () => {
  it('timesheets adapters expose the expected methods', () => {
    const nativeMethods = extractMethodNames(nativeTimesheetPersistence as unknown as Record<string, unknown>)

    expect(nativeMethods).toEqual([
      'bulkUpdate',
      'countByProject',
      'create',
      'getBackfillWindow',
      'getById',
      'getByIds',
      'getByUserDate',
      'getLatest',
      'list',
      'projectEligibility',
      'remove',
      'sumHoursForUserDate',
      'sumHoursForUserDates',
      'update',
    ])
  })

  it('reference adapters expose the expected methods', () => {
    const nativeMethods = extractMethodNames(nativeReferencePersistence as unknown as Record<string, unknown>)

    expect(nativeMethods).toEqual([
      'addTitle',
      'addWhitelistedDomain',
      'createActivityType',
      'createProject',
      'deleteActivityType',
      'deleteProject',
      'deleteTitle',
      'deleteWhitelistedDomain',
      'getTitleImpact',
      'listActivityTypes',
      'listAllActivityTypes',
      'listProjects',
      'listTitleRecords',
      'listTitles',
      'listWhitelistedDomains',
      'reclassifyTitle',
      'renameActivityType',
      'renameProject',
      'setActivityTypeActive',
      'setProjectSO',
      'updateWhitelistedDomain',
    ])
  })

  it('people adapters (persistence and identity) expose the expected methods', () => {
    const nativePersistMethods = extractMethodNames(nativePeoplePersistence as unknown as Record<string, unknown>)

    expect(nativePersistMethods).toEqual([
      'getProfileByEmail',
      'getProfileById',
      'listProfiles',
      'listTitleRecords',
      'updateMyProfile',
      'updateUser',
      'updateUserHierarchy',
      'updateUserManager',
      'updateUserName',
      'updateUserRoles',
      'updateUserStatus',
      'writeAuditLog',
    ])

    const nativeIdMethods = extractMethodNames(nativePeopleIdentity as unknown as Record<string, unknown>)

    expect(nativeIdMethods).toEqual(['createAccount', 'deleteAccount'])
  })

  it('reporting adapters expose the expected methods', () => {
    const nativeMethods = extractMethodNames(nativeReportingPersistence as unknown as Record<string, unknown>)

    expect(nativeMethods).toEqual(['getGroupedReportTotals', 'listTimesheets'])
  })

  it('leave and reminders adapters expose the expected methods', () => {
    const nativeMethods = extractMethodNames(nativeLeaveReminderPersistence as unknown as Record<string, unknown>)

    expect(nativeMethods).toEqual([
      'createGlobalReminder',
      'createLeaves',
      'createReminder',
      'deleteGlobalReminder',
      'deleteLeave',
      'deleteReminder',
      'dismissGlobalReminder',
      'listDueGlobalReminders',
      'listGlobalReminders',
      'listLeaves',
      'listReminders',
      'updateGlobalReminder',
      'updateReminder',
    ])
  })

  it('workspace adapters expose the expected methods', () => {
    const nativeMethods = extractMethodNames(nativeWorkspacePersistence as unknown as Record<string, unknown>)

    expect(nativeMethods).toEqual([
      'getBackfillWindow',
      'getBranding',
      'getDefaultLayouts',
      'getMobileLayout',
      'setAdminLayout',
      'setBackfillWindow',
      'setBranding',
      'setDashboardLayout',
      'setDefaultLayouts',
      'setMobileLayout',
    ])
  })

  it('operations adapters expose the expected methods', () => {
    const nativeMethods = extractMethodNames(nativeOperationsPersistence as unknown as Record<string, unknown>)

    expect(nativeMethods).toEqual([
      'cleanupRateLimits',
      'deleteUserTimesheets',
      'exportBackup',
      'importTimesheets',
      'releaseRateLimit',
      'reserveRateLimit',
      'resetActivityData',
      'resetAllData',
      'resetTimesheets',
      'restoreBackup',
      'writeAuditLog',
    ])
  })
})
