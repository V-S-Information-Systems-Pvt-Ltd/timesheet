// lib/db/native.ts
// Native PostgreSQL implementation of the Repository interface. Authorization
// is enforced here in SQL/where clauses (the schema has no RLS), mirroring the
// policies documented in supabase/README.md:
//   * profiles: read own; admin/co read all; admin updates.
//   * projects: any signed-in user reads; admin/pm write.
//   * timesheets: own rows for users; admin/co read all; admin writes any.
//   * leaves: own rows for users; admin manages all.
//   * reminders: own rows only.
//   * app_settings: any signed-in user reads; admin writes.

import { query } from './pool'
import { nativeTimesheetPersistence } from './native/timesheets'
import { nativeReferencePersistence } from './native/reference'
import { nativePeopleIdentity, nativePeoplePersistence } from './native/people'
import { nativeReportingPersistence } from './native/reporting'
import { nativeLeaveReminderPersistence } from './native/leave-reminders'
import { nativeWorkspacePersistence } from './native/workspace'
import { nativeOperationsPersistence } from './native/operations'
import type {
  ReportTotalsInput,
  Repository,
  TimesheetInput,
  TimesheetListOptions,
} from './repository'

export const nativeRepository: Repository = {
  // --- profiles ---

  async getProfileById(id) {
    return nativePeoplePersistence.getProfileById(id)
  },

  async getProfileByEmail(email) {
    return nativePeoplePersistence.getProfileByEmail(email)
  },

  async listProfiles(actor) {
    return nativePeoplePersistence.listProfiles(actor)
  },

  async createUser(actor, input) {
    return nativePeopleIdentity.createAccount(actor, input)
  },

  async updateUserStatus(actor, userId, isActive) {
    return nativePeoplePersistence.updateUserStatus(actor, userId, isActive)
  },

  async updateUserRoles(actor, userId, permissionRole, hierarchyRole) {
    return nativePeoplePersistence.updateUserRoles(actor, userId, permissionRole, hierarchyRole)
  },

  async updateUser(actor, userId, input) {
    return nativePeoplePersistence.updateUser(actor, userId, input)
  },

  // --- projects ---

  async listProjects(actor) {
    return nativeReferencePersistence.listProjects(actor)
  },

  async createProject(actor, nameOrInput, options) {
    return nativeReferencePersistence.createProject(actor, nameOrInput, options)
  },

  async renameProject(actor, id, name) {
    return nativeReferencePersistence.renameProject(actor, id, name)
  },

  async setProjectSO(actor, id, soNumber) {
    return nativeReferencePersistence.setProjectSO(actor, id, soNumber)
  },

  async setProjectTelegramNo(actor, id, telegramNo) {
    return nativeReferencePersistence.setProjectTelegramNo(actor, id, telegramNo)
  },

  async deleteProject(actor, id) {
    return nativeReferencePersistence.deleteProject(actor, id)
  },

  // --- timesheets ---

  async listTimesheets(actor, opts: TimesheetListOptions = {}) {
    return nativeTimesheetPersistence.list(actor, opts)
  },

  async getTimesheet(actor, id) {
    return nativeTimesheetPersistence.getById(actor, id)
  },

  async getTimesheetsByIds(actor, ids) {
    return nativeTimesheetPersistence.getByIds(actor, ids)
  },

  async findTimesheetByUserDate(actor, userId, logDate) {
    return nativeTimesheetPersistence.getByUserDate(actor, userId, logDate)
  },

  async getLatestTimesheet(actor, userId) {
    return nativeTimesheetPersistence.getLatest(actor, userId)
  },

  async createTimesheet(actor, input: TimesheetInput) {
    return nativeTimesheetPersistence.create(actor, input)
  },

  async updateTimesheet(actor, id, input: TimesheetInput) {
    return nativeTimesheetPersistence.update(actor, id, input)
  },

  async deleteTimesheet(actor, id) {
    return nativeTimesheetPersistence.remove(actor, id)
  },

  async countTimesheetsByProject(actor, projectId) {
    return nativeTimesheetPersistence.countByProject(actor, projectId)
  },

  // --- leaves ---

  // --- leaves ---

  async listLeaves(actor, opts = {}) {
    return nativeLeaveReminderPersistence.listLeaves(actor, opts)
  },

  async createLeaves(actor, rows) {
    return nativeLeaveReminderPersistence.createLeaves(actor, rows)
  },

  async deleteLeave(actor, id) {
    return nativeLeaveReminderPersistence.deleteLeave(actor, id)
  },

  // --- reminders ---

  async listReminders(actor, userId) {
    return nativeLeaveReminderPersistence.listReminders(actor, userId)
  },

  async createReminder(actor, input) {
    return nativeLeaveReminderPersistence.createReminder(actor, input)
  },

  async updateReminder(actor, id, input) {
    return nativeLeaveReminderPersistence.updateReminder(actor, id, input)
  },

  async deleteReminder(actor, id) {
    return nativeLeaveReminderPersistence.deleteReminder(actor, id)
  },

  async updateMyProfile(actor, input) {
    return nativePeoplePersistence.updateMyProfile(actor, input)
  },

  async updateUserName(actor, userId, name) {
    return nativePeoplePersistence.updateUserName(actor, userId, name)
  },

  async updateUserManager(actor, userId, managerId) {
    return nativePeoplePersistence.updateUserManager(actor, userId, managerId)
  },

  // --- activity types ---

  async listActivityTypes(actor) {
    return nativeReferencePersistence.listActivityTypes(actor)
  },

  async listAllActivityTypes(actor) {
    return nativeReferencePersistence.listAllActivityTypes(actor)
  },

  async createActivityType(actor, nameOrInput, options) {
    return nativeReferencePersistence.createActivityType(actor, nameOrInput, options)
  },

  async renameActivityType(actor, id, name) {
    return nativeReferencePersistence.renameActivityType(actor, id, name)
  },

  async setActivityTypeActive(actor, id, isActive) {
    return nativeReferencePersistence.setActivityTypeActive(actor, id, isActive)
  },

  async setActivityTypeTelegramNo(actor, id, telegramNo) {
    return nativeReferencePersistence.setActivityTypeTelegramNo(actor, id, telegramNo)
  },

  // --- global reminders ---

  async listGlobalReminders(actor) {
    return nativeLeaveReminderPersistence.listGlobalReminders(actor)
  },

  async listDueGlobalReminders(actor) {
    return nativeLeaveReminderPersistence.listDueGlobalReminders(actor)
  },

  async createGlobalReminder(actor, input) {
    return nativeLeaveReminderPersistence.createGlobalReminder(actor, input)
  },

  async updateGlobalReminder(actor, id, input) {
    return nativeLeaveReminderPersistence.updateGlobalReminder(actor, id, input)
  },

  async deleteGlobalReminder(actor, id) {
    return nativeLeaveReminderPersistence.deleteGlobalReminder(actor, id)
  },

  async dismissGlobalReminder(actor, reminderId) {
    return nativeLeaveReminderPersistence.dismissGlobalReminder(actor, reminderId)
  },

  // --- app settings ---

  async getBackfillWindow(actor) {
    return nativeWorkspacePersistence.getBackfillWindow(actor)
  },

  async setBackfillWindow(actor, settings) {
    return nativeWorkspacePersistence.setBackfillWindow(actor, settings)
  },

  async getDefaultLayouts(actor) {
    return nativeWorkspacePersistence.getDefaultLayouts(actor)
  },

  async setDefaultLayouts(actor, layouts) {
    return nativeWorkspacePersistence.setDefaultLayouts(actor, layouts)
  },

  async getBranding(actor) {
    return nativeWorkspacePersistence.getBranding(actor)
  },

  async setBranding(actor, branding) {
    return nativeWorkspacePersistence.setBranding(actor, branding)
  },

  // --- dashboard & mobile layout (own profile) ---

  async setDashboardLayout(actor, layout) {
    return nativeWorkspacePersistence.setDashboardLayout(actor, layout)
  },

  async setAdminLayout(actor, layout) {
    return nativeWorkspacePersistence.setAdminLayout(actor, layout)
  },

  async setMobileLayout(actor, layout) {
    return nativeWorkspacePersistence.setMobileLayout(actor, layout)
  },

  async getMobileLayout(actor) {
    return nativeWorkspacePersistence.getMobileLayout(actor)
  },

  // --- super-admin data lifecycle ---

  async deleteUser(actor, userId) {
    return nativePeopleIdentity.deleteAccount(actor, userId)
  },

  async deleteActivityType(actor, id) {
    return nativeReferencePersistence.deleteActivityType(actor, id)
  },

  async deleteUserTimesheets(actor, userId) {
    return nativeOperationsPersistence.deleteUserTimesheets(actor, userId)
  },

  async resetTimesheets(actor) {
    return nativeOperationsPersistence.resetTimesheets(actor)
  },

  async resetActivityData(actor) {
    return nativeOperationsPersistence.resetActivityData(actor)
  },

  async resetAllData(actor) {
    return nativeOperationsPersistence.resetAllData(actor)
  },

  async importTimesheets(actor, rows) {
    return nativeOperationsPersistence.importTimesheets(actor, rows)
  },

  async bulkUpdateTimesheets(actor, rows) {
    return nativeTimesheetPersistence.bulkUpdate(actor, rows)
  },

  // --- backup & restore (admin) ---

  async exportBackup(actor) {
    return nativeOperationsPersistence.exportBackup(actor)
  },

  async restoreBackup(actor, payload) {
    return nativeOperationsPersistence.restoreBackup(actor, payload)
  },

  // --- daily hour totals (multi-entry per day, capped at 24h) ---

  async sumHoursForUserDate(actor, userId, logDate, excludeEntryId) {
    return nativeTimesheetPersistence.sumHoursForUserDate(actor, userId, logDate, excludeEntryId)
  },

  async sumHoursForUserDates(actor, userDatePairs) {
    return nativeTimesheetPersistence.sumHoursForUserDates(actor, userDatePairs)
  },

  async getGroupedReportTotals(actor, input: ReportTotalsInput, groupBy) {
    return nativeReportingPersistence.getGroupedReportTotals(actor, input, groupBy)
  },

  async writeAuditLog(actor, input) {
    return nativePeoplePersistence.writeAuditLog(actor, input)
  },

  // --- shared rate limiting ---

  async reserveRateLimit(input) {
    return nativeOperationsPersistence.reserveRateLimit(input)
  },

  async releaseRateLimit(input) {
    return nativeOperationsPersistence.releaseRateLimit(input)
  },

  async cleanupRateLimits(before) {
    return nativeOperationsPersistence.cleanupRateLimits(before)
  },

  // --- email domain whitelist ---

  async listWhitelistedDomains(actor) {
    return nativeReferencePersistence.listWhitelistedDomains(actor)
  },

  async addWhitelistedDomain(actor, domain, autoActivate) {
    return nativeReferencePersistence.addWhitelistedDomain(actor, domain, autoActivate)
  },

  async updateWhitelistedDomain(actor, id, autoActivate) {
    return nativeReferencePersistence.updateWhitelistedDomain(actor, id, autoActivate)
  },

  async deleteWhitelistedDomain(actor, id) {
    return nativeReferencePersistence.deleteWhitelistedDomain(actor, id)
  },

  async findWhitelistedDomain(domain) {
    const clean = domain.trim().toLowerCase().replace(/^@/, '')
    const rows = await query<{
      id: string
      domain: string
      auto_activate: boolean
      created_at: string
    }>('select id, domain, auto_activate, created_at from public.whitelisted_domains where lower(domain) = $1 limit 1', [clean])
    return rows[0] ?? null
  },

  // --- hierarchy & reporting structure ---

  async updateUserHierarchy(actor, userId, data) {
    return nativePeoplePersistence.updateUserHierarchy(actor, userId, data)
  },

  // --- titles management ---

  async listTitles() {
    return nativeReferencePersistence.listTitles()
  },

  async listTitleRecords() {
    return nativeReferencePersistence.listTitleRecords()
  },

  async addTitle(actor, name, hierarchyRole = 'user') {
    return nativeReferencePersistence.addTitle(actor, name, hierarchyRole)
  },

  async deleteTitle(actor, name) {
    return nativeReferencePersistence.deleteTitle(actor, name)
  },

  async reclassifyTitle(actor, name, hierarchyRole, syncUsers = false) {
    return nativeReferencePersistence.reclassifyTitle(actor, name, hierarchyRole, syncUsers)
  },

  async getTitleImpact(actor, name, proposedRole) {
    return nativeReferencePersistence.getTitleImpact(actor, name, proposedRole)
  },
}
