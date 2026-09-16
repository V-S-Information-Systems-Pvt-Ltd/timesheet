// lib/db/supabase.ts
// Supabase implementation of the Repository interface. This is a thin mapping
// onto the Supabase server client; Row Level Security in Postgres does the
// heavy lifting for row-level authorization, while the actor-based role checks
// mirror the application logic in app/actions.ts.

import { getAdminClient } from '@/lib/supabase/admin'
import { supabaseTimesheetPersistence } from './supabase/timesheets'
import { supabaseReferencePersistence } from './supabase/reference'
import { supabasePeopleIdentity, supabasePeoplePersistence } from './supabase/people'
import { supabaseReportingPersistence } from './supabase/reporting'
import { supabaseLeaveReminderPersistence } from './supabase/leave-reminders'
import { supabaseWorkspacePersistence } from './supabase/workspace'
import { supabaseOperationsPersistence } from './supabase/operations'
import type { WhitelistedDomain } from '@/app/types'
import type {
  CreateUserInput,
  Repository,
  TimesheetInput,
  TimesheetListOptions,
} from './repository'


export const supabaseRepository: Repository = {
  // --- profiles ---

  async getProfileById(id) {
    return supabasePeoplePersistence.getProfileById(id)
  },

  async getProfileByEmail(email) {
    return supabasePeoplePersistence.getProfileByEmail(email)
  },

  async listProfiles(actor) {
    return supabasePeoplePersistence.listProfiles(actor)
  },

  async createUser(actor, input: CreateUserInput) {
    return supabasePeopleIdentity.createAccount(actor, input)
  },

  async updateUserStatus(actor, userId, isActive) {
    return supabasePeoplePersistence.updateUserStatus(actor, userId, isActive)
  },

  async updateUserRoles(actor, userId, permissionRole, hierarchyRole) {
    return supabasePeoplePersistence.updateUserRoles(actor, userId, permissionRole, hierarchyRole)
  },

  async updateUser(actor, userId, input) {
    return supabasePeoplePersistence.updateUser(actor, userId, input)
  },

  // --- projects ---

  async listProjects(actor) {
    return supabaseReferencePersistence.listProjects(actor)
  },

  async createProject(actor, nameOrInput, options) {
    return supabaseReferencePersistence.createProject(actor, nameOrInput, options)
  },

  async renameProject(actor, id, name) {
    return supabaseReferencePersistence.renameProject(actor, id, name)
  },

  async setProjectSO(actor, id, soNumber) {
    return supabaseReferencePersistence.setProjectSO(actor, id, soNumber)
  },

  async setProjectTelegramNo(actor, id, telegramNo) {
    return supabaseReferencePersistence.setProjectTelegramNo(actor, id, telegramNo)
  },

  async deleteProject(actor, id) {
    return supabaseReferencePersistence.deleteProject(actor, id)
  },

  // --- timesheets ---

  async listTimesheets(actor, opts: TimesheetListOptions = {}) {
    return supabaseTimesheetPersistence.list(actor, opts)
  },

  async getTimesheet(actor, id) {
    return supabaseTimesheetPersistence.getById(actor, id)
  },

  async getTimesheetsByIds(actor, ids) {
    return supabaseTimesheetPersistence.getByIds(actor, ids)
  },

  async findTimesheetByUserDate(actor, userId, logDate) {
    return supabaseTimesheetPersistence.getByUserDate(actor, userId, logDate)
  },

  async getLatestTimesheet(actor, userId) {
    return supabaseTimesheetPersistence.getLatest(actor, userId)
  },

  async createTimesheet(actor, input: TimesheetInput) {
    return supabaseTimesheetPersistence.create(actor, input)
  },

  async updateTimesheet(actor, id, input: TimesheetInput) {
    return supabaseTimesheetPersistence.update(actor, id, input)
  },

  async deleteTimesheet(actor, id) {
    return supabaseTimesheetPersistence.remove(actor, id)
  },

  async countTimesheetsByProject(actor, projectId) {
    return supabaseTimesheetPersistence.countByProject(actor, projectId)
  },

  // --- leaves ---

  async listLeaves(actor, opts = {}) {
    return supabaseLeaveReminderPersistence.listLeaves(actor, opts)
  },

  async createLeaves(actor, rows) {
    return supabaseLeaveReminderPersistence.createLeaves(actor, rows)
  },

  async deleteLeave(actor, id) {
    return supabaseLeaveReminderPersistence.deleteLeave(actor, id)
  },

  // --- reminders ---

  async listReminders(actor, userId) {
    return supabaseLeaveReminderPersistence.listReminders(actor, userId)
  },

  async createReminder(actor, input) {
    return supabaseLeaveReminderPersistence.createReminder(actor, input)
  },

  async updateReminder(actor, id, input) {
    return supabaseLeaveReminderPersistence.updateReminder(actor, id, input)
  },

  async deleteReminder(actor, id) {
    return supabaseLeaveReminderPersistence.deleteReminder(actor, id)
  },

  // --- profile self-service / admin name ---

  async updateMyProfile(actor, input) {
    return supabasePeoplePersistence.updateMyProfile(actor, input)
  },

  async updateUserName(actor, userId, name) {
    return supabasePeoplePersistence.updateUserName(actor, userId, name)
  },

  async updateUserManager(actor, userId, managerId) {
    return supabasePeoplePersistence.updateUserManager(actor, userId, managerId)
  },

  // --- activity types ---

  async listActivityTypes(actor) {
    return supabaseReferencePersistence.listActivityTypes(actor)
  },

  async listAllActivityTypes(actor) {
    return supabaseReferencePersistence.listAllActivityTypes(actor)
  },

  async createActivityType(actor, nameOrInput, options) {
    return supabaseReferencePersistence.createActivityType(actor, nameOrInput, options)
  },

  async renameActivityType(actor, id, name) {
    return supabaseReferencePersistence.renameActivityType(actor, id, name)
  },

  async setActivityTypeActive(actor, id, isActive) {
    return supabaseReferencePersistence.setActivityTypeActive(actor, id, isActive)
  },

  async setActivityTypeTelegramNo(actor, id, telegramNo) {
    return supabaseReferencePersistence.setActivityTypeTelegramNo(actor, id, telegramNo)
  },

  // --- global reminders ---

  async listGlobalReminders(actor) {
    return supabaseLeaveReminderPersistence.listGlobalReminders(actor)
  },

  async listDueGlobalReminders(actor) {
    return supabaseLeaveReminderPersistence.listDueGlobalReminders(actor)
  },

  async createGlobalReminder(actor, input) {
    return supabaseLeaveReminderPersistence.createGlobalReminder(actor, input)
  },

  async updateGlobalReminder(actor, id, input) {
    return supabaseLeaveReminderPersistence.updateGlobalReminder(actor, id, input)
  },

  async deleteGlobalReminder(actor, id) {
    return supabaseLeaveReminderPersistence.deleteGlobalReminder(actor, id)
  },

  async dismissGlobalReminder(actor, reminderId) {
    return supabaseLeaveReminderPersistence.dismissGlobalReminder(actor, reminderId)
  },

  // --- app settings & branding ---

  async getBackfillWindow(actor) {
    return supabaseWorkspacePersistence.getBackfillWindow(actor)
  },

  async setBackfillWindow(actor, settings) {
    return supabaseWorkspacePersistence.setBackfillWindow(actor, settings)
  },

  async getDefaultLayouts(actor) {
    return supabaseWorkspacePersistence.getDefaultLayouts(actor)
  },

  async setDefaultLayouts(actor, layouts) {
    return supabaseWorkspacePersistence.setDefaultLayouts(actor, layouts)
  },

  async getBranding(actor) {
    return supabaseWorkspacePersistence.getBranding(actor)
  },

  async setBranding(actor, branding) {
    return supabaseWorkspacePersistence.setBranding(actor, branding)
  },

  // --- dashboard & mobile layout (own profile) ---

  async setDashboardLayout(actor, layout) {
    return supabaseWorkspacePersistence.setDashboardLayout(actor, layout)
  },

  async setAdminLayout(actor, layout) {
    return supabaseWorkspacePersistence.setAdminLayout(actor, layout)
  },

  async setMobileLayout(actor, layout) {
    return supabaseWorkspacePersistence.setMobileLayout(actor, layout)
  },

  async getMobileLayout(actor) {
    return supabaseWorkspacePersistence.getMobileLayout(actor)
  },

  // --- super-admin data lifecycle (service role bypasses RLS) ---

  async deleteUser(actor, userId) {
    return supabasePeopleIdentity.deleteAccount(actor, userId)
  },

  async deleteActivityType(actor, id) {
    return supabaseReferencePersistence.deleteActivityType(actor, id)
  },

  async deleteUserTimesheets(actor, userId) {
    return supabaseOperationsPersistence.deleteUserTimesheets(actor, userId)
  },

  async resetTimesheets(actor) {
    return supabaseOperationsPersistence.resetTimesheets(actor)
  },

  async resetActivityData(actor) {
    return supabaseOperationsPersistence.resetActivityData(actor)
  },

  async resetAllData(actor) {
    return supabaseOperationsPersistence.resetAllData(actor)
  },

  async importTimesheets(actor, rows) {
    return supabaseOperationsPersistence.importTimesheets(actor, rows)
  },

  async bulkUpdateTimesheets(actor, rows) {
    return supabaseTimesheetPersistence.bulkUpdate(actor, rows)
  },

  // --- backup & restore (admin) ---

  async exportBackup(actor) {
    return supabaseOperationsPersistence.exportBackup(actor)
  },

  async restoreBackup(actor, payload) {
    return supabaseOperationsPersistence.restoreBackup(actor, payload)
  },

  // --- daily hour totals (multi-entry per day, capped at 24h) ---

  async sumHoursForUserDate(actor, userId, logDate, excludeEntryId) {
    return supabaseTimesheetPersistence.sumHoursForUserDate(actor, userId, logDate, excludeEntryId)
  },

  async sumHoursForUserDates(actor, userDatePairs) {
    return supabaseTimesheetPersistence.sumHoursForUserDates(actor, userDatePairs)
  },

  async getGroupedReportTotals(actor, input, groupBy) {
    return supabaseReportingPersistence.getGroupedReportTotals(
      actor,
      input,
      groupBy,
      (a, opts) => this.listTimesheets(a, opts)
    )
  },

  async writeAuditLog(actor, input) {
    return supabasePeoplePersistence.writeAuditLog(actor, input)
  },

  // --- shared rate limiting ---

  async reserveRateLimit(input) {
    return supabaseOperationsPersistence.reserveRateLimit(input)
  },

  async releaseRateLimit(input) {
    return supabaseOperationsPersistence.releaseRateLimit(input)
  },

  async cleanupRateLimits(before) {
    return supabaseOperationsPersistence.cleanupRateLimits(before)
  },

  // --- email domain whitelist ---

  async listWhitelistedDomains(actor) {
    return supabaseReferencePersistence.listWhitelistedDomains(actor)
  },

  async addWhitelistedDomain(actor, domain, autoActivate) {
    return supabaseReferencePersistence.addWhitelistedDomain(actor, domain, autoActivate)
  },

  async updateWhitelistedDomain(actor, id, autoActivate) {
    return supabaseReferencePersistence.updateWhitelistedDomain(actor, id, autoActivate)
  },

  async deleteWhitelistedDomain(actor, id) {
    return supabaseReferencePersistence.deleteWhitelistedDomain(actor, id)
  },

  async findWhitelistedDomain(domain) {
    const clean = domain.trim().toLowerCase().replace(/^@/, '')
    // Signup is unauthenticated, while the whitelist is intentionally hidden
    // from anonymous clients by RLS. Keep this exact-domain lookup server-only
    // and privileged rather than exposing the table through an anon policy.
    const { data, error } = await getAdminClient()
      .from('whitelisted_domains')
      .select('id, domain, auto_activate, created_at')
      .eq('domain', clean)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as WhitelistedDomain | null) ?? null
  },

  // --- hierarchy & reporting structure ---

  async updateUserHierarchy(actor, userId, data) {
    return supabasePeoplePersistence.updateUserHierarchy(actor, userId, data)
  },

  // --- titles management ---

  async listTitles() {
    return supabaseReferencePersistence.listTitles()
  },

  async listTitleRecords() {
    return supabaseReferencePersistence.listTitleRecords()
  },

  async addTitle(actor, name, hierarchyRole = 'user') {
    return supabaseReferencePersistence.addTitle(actor, name, hierarchyRole)
  },

  async deleteTitle(actor, name) {
    return supabaseReferencePersistence.deleteTitle(actor, name)
  },

  async reclassifyTitle(actor, name, hierarchyRole, syncUsers = false) {
    return supabaseReferencePersistence.reclassifyTitle(actor, name, hierarchyRole, syncUsers)
  },

  async getTitleImpact(actor, name, proposedRole) {
    return supabaseReferencePersistence.getTitleImpact(actor, name, proposedRole)
  },
}



