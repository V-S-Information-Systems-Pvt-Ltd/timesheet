// app/actions.ts
// Re-export all domain actions from modular action files for clean organization
// and backward compatibility across the codebase and test suites.

export type { ActionResult } from './actions/_helpers'

export {
  logEntry,
  duplicateEntry,
  logYesterday,
  deleteLastEntry,
  updateTimesheet,
  deleteTimesheet,
  bulkUpdateTimesheets,
} from './actions/timesheet-actions'

export {
  addProject,
  renameProject,
  setProjectSO,
  setProjectTelegramNo,
  deleteProject,
} from './actions/project-actions'

export {
  addUser,
  toggleUserStatus,
  updateUserRole,
  updateUserName,
  setUserManager,
  updateMyProfile,
} from './actions/user-actions'

export {
  addActivityType,
  renameActivityType,
  setActivityTypeActive,
  setActivityTypeTelegramNo,
  addGlobalReminder,
  deleteGlobalReminder,
  dismissGlobalReminder,
  setBackfillWindow,
  saveDashboardLayout,
  saveAdminLayout,
  amISuperAdmin,
  resetDatabase,
  deleteUser,
  deleteActivityType,
  deleteUserTimesheets,
  getWhitelistedDomains,
  addWhitelistedDomain,
  toggleDomainAutoActivate,
  deleteWhitelistedDomain,
  updateUserHierarchy,
} from './actions/admin-actions'

export {
  importTimesheets,
  exportBackup,
  restoreBackup,
  type CsvTimesheetRow,
} from './actions/import-actions'

