// app/actions.ts
// Explicit async facade functions preserving Next.js 16 Server Action boundaries.
'use server'

import * as timesheets from './actions/timesheets'
import * as projects from './actions/projects'
import * as users from './actions/users'
import * as settings from './actions/settings'
import * as importBackup from './actions/import-backup'
import * as superadmin from './actions/superadmin'

export type { CsvTimesheetRow } from './actions/import-backup'

// --- timesheets ---
export async function logEntry(...args: Parameters<typeof timesheets.logEntry>) {
  return timesheets.logEntry(...args)
}
export async function duplicateEntry(...args: Parameters<typeof timesheets.duplicateEntry>) {
  return timesheets.duplicateEntry(...args)
}
export async function logYesterday(...args: Parameters<typeof timesheets.logYesterday>) {
  return timesheets.logYesterday(...args)
}
export async function deleteLastEntry(...args: Parameters<typeof timesheets.deleteLastEntry>) {
  return timesheets.deleteLastEntry(...args)
}
export async function updateTimesheet(...args: Parameters<typeof timesheets.updateTimesheet>) {
  return timesheets.updateTimesheet(...args)
}
export async function deleteTimesheet(...args: Parameters<typeof timesheets.deleteTimesheet>) {
  return timesheets.deleteTimesheet(...args)
}
export async function bulkUpdateTimesheets(...args: Parameters<typeof timesheets.bulkUpdateTimesheets>) {
  return timesheets.bulkUpdateTimesheets(...args)
}

// --- projects ---
export async function addProject(...args: Parameters<typeof projects.addProject>) {
  return projects.addProject(...args)
}
export async function renameProject(...args: Parameters<typeof projects.renameProject>) {
  return projects.renameProject(...args)
}
export async function setProjectSO(...args: Parameters<typeof projects.setProjectSO>) {
  return projects.setProjectSO(...args)
}
export async function setProjectTelegramNo(...args: Parameters<typeof projects.setProjectTelegramNo>) {
  return projects.setProjectTelegramNo(...args)
}
export async function deleteProject(...args: Parameters<typeof projects.deleteProject>) {
  return projects.deleteProject(...args)
}

// --- users ---
export async function addUser(...args: Parameters<typeof users.addUser>) {
  return users.addUser(...args)
}
export async function toggleUserStatus(...args: Parameters<typeof users.toggleUserStatus>) {
  return users.toggleUserStatus(...args)
}
export async function updateUserRoles(...args: Parameters<typeof users.updateUserRoles>) {
  return users.updateUserRoles(...args)
}
export async function updateUserName(...args: Parameters<typeof users.updateUserName>) {
  return users.updateUserName(...args)
}
export async function updateUserDepartment(...args: Parameters<typeof users.updateUserDepartment>) {
  return users.updateUserDepartment(...args)
}
export async function setUserManager(...args: Parameters<typeof users.setUserManager>) {
  return users.setUserManager(...args)
}
export async function updateMyProfile(...args: Parameters<typeof users.updateMyProfile>) {
  return users.updateMyProfile(...args)
}
export async function updateUserHierarchy(...args: Parameters<typeof users.updateUserHierarchy>) {
  return users.updateUserHierarchy(...args)
}

// --- settings & layouts ---
export async function addActivityType(...args: Parameters<typeof settings.addActivityType>) {
  return settings.addActivityType(...args)
}
export async function renameActivityType(...args: Parameters<typeof settings.renameActivityType>) {
  return settings.renameActivityType(...args)
}
export async function setActivityTypeActive(...args: Parameters<typeof settings.setActivityTypeActive>) {
  return settings.setActivityTypeActive(...args)
}
export async function setActivityTypeTelegramNo(...args: Parameters<typeof settings.setActivityTypeTelegramNo>) {
  return settings.setActivityTypeTelegramNo(...args)
}
export async function addGlobalReminder(...args: Parameters<typeof settings.addGlobalReminder>) {
  return settings.addGlobalReminder(...args)
}
export async function deleteGlobalReminder(...args: Parameters<typeof settings.deleteGlobalReminder>) {
  return settings.deleteGlobalReminder(...args)
}
export async function dismissGlobalReminder(...args: Parameters<typeof settings.dismissGlobalReminder>) {
  return settings.dismissGlobalReminder(...args)
}
export async function setBackfillWindow(...args: Parameters<typeof settings.setBackfillWindow>) {
  return settings.setBackfillWindow(...args)
}
export async function saveDashboardLayout(...args: Parameters<typeof settings.saveDashboardLayout>) {
  return settings.saveDashboardLayout(...args)
}
export async function saveAdminLayout(...args: Parameters<typeof settings.saveAdminLayout>) {
  return settings.saveAdminLayout(...args)
}
export async function getDefaultLayouts(...args: Parameters<typeof settings.getDefaultLayouts>) {
  return settings.getDefaultLayouts(...args)
}
export async function getTitles(...args: Parameters<typeof settings.getTitles>) {
  return settings.getTitles(...args)
}
export async function getTitleRecords(...args: Parameters<typeof settings.getTitleRecords>) {
  return settings.getTitleRecords(...args)
}
export async function getBranding(...args: Parameters<typeof settings.getBranding>) {
  return settings.getBranding(...args)
}
export async function saveBranding(...args: Parameters<typeof settings.saveBranding>) {
  return settings.saveBranding(...args)
}
export async function resetBranding(...args: Parameters<typeof settings.resetBranding>) {
  return settings.resetBranding(...args)
}

// --- import & backup ---
export async function importTimesheets(...args: Parameters<typeof importBackup.importTimesheets>) {
  return importBackup.importTimesheets(...args)
}
export async function exportBackup(...args: Parameters<typeof importBackup.exportBackup>) {
  return importBackup.exportBackup(...args)
}
export async function restoreBackup(...args: Parameters<typeof importBackup.restoreBackup>) {
  return importBackup.restoreBackup(...args)
}
export async function deleteUserTimesheets(...args: Parameters<typeof importBackup.deleteUserTimesheets>) {
  return importBackup.deleteUserTimesheets(...args)
}

// --- superadmin ---
export async function setDefaultLayouts(...args: Parameters<typeof superadmin.setDefaultLayouts>) {
  return superadmin.setDefaultLayouts(...args)
}
export async function amISuperAdmin(...args: Parameters<typeof superadmin.amISuperAdmin>) {
  return superadmin.amISuperAdmin(...args)
}
export async function resetDatabase(...args: Parameters<typeof superadmin.resetDatabase>) {
  return superadmin.resetDatabase(...args)
}
export async function deleteUser(...args: Parameters<typeof superadmin.deleteUser>) {
  return superadmin.deleteUser(...args)
}
export async function deleteActivityType(...args: Parameters<typeof superadmin.deleteActivityType>) {
  return superadmin.deleteActivityType(...args)
}
export async function getWhitelistedDomains(...args: Parameters<typeof superadmin.getWhitelistedDomains>) {
  return superadmin.getWhitelistedDomains(...args)
}
export async function addWhitelistedDomain(...args: Parameters<typeof superadmin.addWhitelistedDomain>) {
  return superadmin.addWhitelistedDomain(...args)
}
export async function toggleDomainAutoActivate(...args: Parameters<typeof superadmin.toggleDomainAutoActivate>) {
  return superadmin.toggleDomainAutoActivate(...args)
}
export async function deleteWhitelistedDomain(...args: Parameters<typeof superadmin.deleteWhitelistedDomain>) {
  return superadmin.deleteWhitelistedDomain(...args)
}
export async function addTitle(...args: Parameters<typeof superadmin.addTitle>) {
  return superadmin.addTitle(...args)
}
export async function getTitleImpact(...args: Parameters<typeof superadmin.getTitleImpact>) {
  return superadmin.getTitleImpact(...args)
}
export async function reclassifyTitle(...args: Parameters<typeof superadmin.reclassifyTitle>) {
  return superadmin.reclassifyTitle(...args)
}
export async function deleteTitle(...args: Parameters<typeof superadmin.deleteTitle>) {
  return superadmin.deleteTitle(...args)
}
