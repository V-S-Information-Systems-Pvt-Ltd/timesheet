// Canonical timesheet wire contract is shared with the server via
// @vsis/contracts; re-exported here so existing mobile imports keep working.
import type {
  ActivityTypeDto as ActivityTypeItem,
  IdentityChangePasswordInput,
  IdentityLoginInput,
  IdentitySignupInput,
  MobileActorDto as MobileActor,
  MobileBackend,
  ProjectDto as ProjectItem,
  TimesheetEntry,
  TitleItemDto as TitleItem,
  WorkspaceBranding,
} from '@vsis/contracts';

export type {
  ApiErrorBody,
  ApiResult,
  TimesheetEntry,
  CreateTimesheetInput,
  TimesheetListParams,
  TimesheetListResult,
  BatchDeleteResultItem,
  BatchDeleteTimesheetsResponse,
  BatchDuplicateItem,
  BatchDuplicateResultItem,
  BatchDuplicateTimesheetsResponse,
} from '@vsis/contracts';

export type {
  BackfillSettings,
  MobileBackend,
  MobileLayout,
  MobileLayoutResponse,
  MobileModuleId,
  MobileModuleSetting,
  WorkspaceBranding,
} from '@vsis/contracts';

export type MobileLoginInput = IdentityLoginInput;
export type SignupInput = IdentitySignupInput;
export type ChangePasswordInput = IdentityChangePasswordInput;

export const DEFAULT_BRANDING: WorkspaceBranding = {
  appName: 'VSIS Timesheet',
  primaryColor: '#1E73BE',
  logoUrl: null,
};

export interface MobileConfig {
  apiVersion: 1;
  appVersion: string;
  backend: MobileBackend;
  capabilities: {
    bearerAuth: boolean;
    mobileApi: boolean;
    /**
     * Server performs atomic claim+write+ledger for keyed offline mutations.
     * Missing means false so newer mobile clients never auto-replay against a
     * server that may ignore Idempotency-Key (duplicate writes after a lost
     * response).
     */
    durableIdempotency?: boolean;
  };
  branding?: WorkspaceBranding;
}

// Canonical domain wire contracts are shared with the server via
// @vsis/contracts; the mobile aliases below preserve existing import names.
export type {
  ActorCapabilities as MobileActorCapabilities,
  ActorCapabilities,
  MobileActorDto as MobileActor,
  ProjectDto as ProjectItem,
  ActivityTypeDto as ActivityTypeItem,
  TitleItemDto as TitleItem,
  GlobalReminderDto as GlobalReminderItem,
  ReportBucketDto as ReportBucketItem,
  ReportTotalsDto as ReportTotals,
  PersonProfileDto as PersonProfile,
} from '@vsis/contracts';

export interface MobileTokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  sessionId: string;
}

export interface MobileLoginData extends MobileTokenPair {
  actor: MobileActor;
}

export interface MobileDashboardData {
  actor: MobileActor;
  today: { date: string; hours: number };
  week: { from: string; to: string; hours: number };
  recentEntries: TimesheetEntry[];
  quickActions: string[];
}

export interface MobileReferenceData {
  projects: ProjectItem[];
  activityTypes: ActivityTypeItem[];
  titles?: string[];
  titleItems?: TitleItem[];
}

export interface LeaveRow {
  id: string;
  user_id: string;
  leave_date: string;
  reason: string;
  created_at?: string;
}

export interface CreateLeaveInput {
  userId?: string;
  leaveDate: string;
  reason: string;
}

export interface ReminderItem {
  id: string;
  user_id: string;
  message: string;
  remind_at: string;
  done: boolean;
  created_at?: string;
}

export interface UpdateProfileInput {
  department?: string;
  title?: string;
}

export interface SignupResult {
  success: boolean;
  isActive: boolean;
  message: string;
}

export interface CreateReminderInput {
  message: string;
  remindAt: string;
}

export interface ReportParams {
  project?: string;
  user?: string;
  userId?: string;
  from?: string;
  to?: string;
  groupBy?: 'user' | 'project' | 'activity';
}

export interface ProjectAdminItem {
  id: string;
  name: string;
  so_number?: string | null;
  telegram_no?: number | null;
  created_at?: string;
}

export interface CreateProjectInput {
  name: string;
  soNumber?: string;
  telegramNo?: number | null;
}

export interface UpdateProjectInput {
  name?: string;
  soNumber?: string | null;
  telegramNo?: number | null;
}

export interface ActivityTypeAdminItem {
  id: string;
  name: string;
  is_active?: boolean;
  telegram_no?: number | null;
}

export interface CreateActivityTypeInput {
  name: string;
  telegramNo?: number | null;
}

export interface UpdateActivityTypeInput {
  name?: string;
  isActive?: boolean;
  telegramNo?: number | null;
}

export interface CreateAdminUserInput {
  email: string;
  password: string;
  name: string;
  department?: string;
  title?: string;
  permissionRole: string;
  hierarchyRole?: string;
  isActive?: boolean;
  managerId?: string | null;
}

export interface UpdateAdminUserInput {
  name?: string;
  department?: string;
  title?: string;
  permissionRole?: string;
  hierarchyRole?: string;
  isActive?: boolean;
  managerId?: string | null;
}

export interface TitleAdminItem {
  id: string;
  name: string;
  hierarchyRole: string;
  isCustom?: boolean;
}

export interface CreateTitleInput {
  name: string;
  hierarchyRole: string;
}

export interface ReclassifyTitleInput {
  name: string;
  hierarchyRole: string;
  syncUsers?: boolean;
}

export interface TitleImpactInfo {
  title: string;
  currentHierarchyRole: string;
  proposedHierarchyRole: string;
  affectedCount: number;
  syncRequired: boolean;
}

export interface CreateAdminLeaveInput {
  userId: string;
  date: string;
  reason?: string;
}

export interface CreateGlobalReminderInput {
  message: string;
  remindAt: string;
}
