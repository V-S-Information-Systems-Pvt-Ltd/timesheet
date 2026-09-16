// tests/domain-adapter-contracts.test.ts
//
// Parity test suite verifying that both native and supabase domain adapters
// export objects matching the complete domain persistence interface contracts.

import { describe, expect, it } from 'vitest'

import { nativeTimesheetPersistence } from '../lib/db/native/timesheets'
import { supabaseTimesheetPersistence } from '../lib/db/supabase/timesheets'
import { nativeReferencePersistence } from '../lib/db/native/reference'
import { supabaseReferencePersistence } from '../lib/db/supabase/reference'
import {
  nativePeopleIdentity,
  nativePeoplePersistence,
} from '../lib/db/native/people'
import {
  supabasePeopleIdentity,
  supabasePeoplePersistence,
} from '../lib/db/supabase/people'
import { nativeReportingPersistence } from '../lib/db/native/reporting'
import { supabaseReportingPersistence } from '../lib/db/supabase/reporting'
import { nativeLeaveReminderPersistence } from '../lib/db/native/leave-reminders'
import { supabaseLeaveReminderPersistence } from '../lib/db/supabase/leave-reminders'
import { nativeWorkspacePersistence } from '../lib/db/native/workspace'
import { supabaseWorkspacePersistence } from '../lib/db/supabase/workspace'
import { nativeOperationsPersistence } from '../lib/db/native/operations'
import { supabaseOperationsPersistence } from '../lib/db/supabase/operations'

function extractMethodNames(obj: Record<string, unknown>): string[] {
  return Object.keys(obj)
    .filter((key) => typeof obj[key] === 'function')
    .sort()
}

describe('domain adapter contract parity', () => {
  it('timesheets adapters have identical method signatures', () => {
    const nativeMethods = extractMethodNames(nativeTimesheetPersistence as unknown as Record<string, unknown>)
    const supabaseMethods = extractMethodNames(supabaseTimesheetPersistence as unknown as Record<string, unknown>)

    expect(nativeMethods).toEqual(supabaseMethods)
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
      'remove',
      'sumHoursForUserDate',
      'sumHoursForUserDates',
      'update',
    ])
  })

  it('reference adapters have identical method signatures', () => {
    const nativeMethods = extractMethodNames(nativeReferencePersistence as unknown as Record<string, unknown>)
    const supabaseMethods = extractMethodNames(supabaseReferencePersistence as unknown as Record<string, unknown>)

    expect(nativeMethods).toEqual(supabaseMethods)
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
      'setActivityTypeTelegramNo',
      'setProjectSO',
      'setProjectTelegramNo',
      'updateWhitelistedDomain',
    ])
  })

  it('people adapters (persistence and identity) have identical method signatures', () => {
    const nativePersistMethods = extractMethodNames(nativePeoplePersistence as unknown as Record<string, unknown>)
    const supabasePersistMethods = extractMethodNames(supabasePeoplePersistence as unknown as Record<string, unknown>)

    expect(nativePersistMethods).toEqual(supabasePersistMethods)
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
    const supabaseIdMethods = extractMethodNames(supabasePeopleIdentity as unknown as Record<string, unknown>)

    expect(nativeIdMethods).toEqual(supabaseIdMethods)
    expect(nativeIdMethods).toEqual(['createAccount', 'deleteAccount'])
  })

  it('reporting adapters have identical method signatures', () => {
    const nativeMethods = extractMethodNames(nativeReportingPersistence as unknown as Record<string, unknown>)
    const supabaseMethods = extractMethodNames(supabaseReportingPersistence as unknown as Record<string, unknown>)

    expect(nativeMethods).toEqual(supabaseMethods)
    expect(nativeMethods).toEqual(['getGroupedReportTotals', 'listTimesheets'])
  })

  it('leave and reminders adapters have identical method signatures', () => {
    const nativeMethods = extractMethodNames(nativeLeaveReminderPersistence as unknown as Record<string, unknown>)
    const supabaseMethods = extractMethodNames(supabaseLeaveReminderPersistence as unknown as Record<string, unknown>)

    expect(nativeMethods).toEqual(supabaseMethods)
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

  it('workspace adapters have identical method signatures', () => {
    const nativeMethods = extractMethodNames(nativeWorkspacePersistence as unknown as Record<string, unknown>)
    const supabaseMethods = extractMethodNames(supabaseWorkspacePersistence as unknown as Record<string, unknown>)

    expect(nativeMethods).toEqual(supabaseMethods)
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

  it('operations adapters have identical method signatures', () => {
    const nativeMethods = extractMethodNames(nativeOperationsPersistence as unknown as Record<string, unknown>)
    const supabaseMethods = extractMethodNames(supabaseOperationsPersistence as unknown as Record<string, unknown>)

    expect(nativeMethods).toEqual(supabaseMethods)
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
