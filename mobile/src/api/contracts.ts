export type MobileBackend = 'supabase' | 'native';

export interface MobileConfig {
  apiVersion: 1;
  appVersion: string;
  backend: MobileBackend;
  capabilities: {
    bearerAuth: boolean;
    mobileApi: boolean;
  };
}

export interface ApiErrorBody {
  code?: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export type ApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: ApiErrorBody };

export interface MobileActorCapabilities {
  canViewTeam: boolean;
  canManageProjects: boolean;
  canManageActivities: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
}

export type ActorCapabilities = MobileActorCapabilities;

export interface MobileActor {
  id: string;
  email: string;
  role: string;
  permissionRole: string;
  hierarchyRole: string;
  name?: string | null;
  department?: string | null;
  title?: string | null;
  managerId?: string | null;
  isActive: boolean;
  capabilities?: MobileActorCapabilities;
}

export interface MobileLoginInput {
  email: string;
  password: string;
  deviceName?: string;
  platform?: 'android' | 'ios' | 'windows';
}

export interface MobileTokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  sessionId: string;
}

export interface MobileLoginData extends MobileTokenPair {
  actor: MobileActor;
}

export interface TimesheetEntry {
  id: string;
  user_id: string;
  user_email?: string;
  project_id: string;
  project_name?: string;
  activity_type_id: string | null;
  activity_name?: string | null;
  log_date: string;
  hours_worked: number;
  work_done: string;
  created_at?: string;
}

export interface CreateTimesheetInput {
  projectId: string;
  activityTypeId: string;
  hoursWorked: number;
  workDone: string;
  logDate: string;
}

export interface MobileDashboardData {
  actor: MobileActor;
  today: { date: string; hours: number };
  week: { from: string; to: string; hours: number };
  recentEntries: TimesheetEntry[];
  quickActions: string[];
}

export interface ProjectItem {
  id: string;
  name: string;
  so_number?: string | null;
  telegram_no?: number | null;
}

export interface ActivityTypeItem {
  id: string;
  name: string;
  is_active?: boolean;
  telegram_no?: number | null;
}

export interface MobileReferenceData {
  projects: ProjectItem[];
  activityTypes: ActivityTypeItem[];
  titles?: string[];
}

export interface TimesheetListParams {
  limit?: number;
  from?: string;
  to?: string;
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
}

export interface TimesheetListResult {
  rows: TimesheetEntry[];
  count?: number;
  total?: number;
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

export interface GlobalReminderItem {
  id: string;
  message: string;
  remind_at: string;
  created_at?: string;
}

export interface UpdateProfileInput {
  department?: string;
  title?: string;
}

export interface SignupInput {
  email: string;
  password: string;
  name?: string;
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

export interface ReportBucketItem {
  label: string;
  hours: number;
  entries: number;
}

export interface ReportTotals {
  totalHours: number;
  totalEntries: number;
  byGroup: ReportBucketItem[];
}

export interface ReportParams {
  project?: string;
  from?: string;
  to?: string;
  groupBy?: 'user' | 'project' | 'activity';
}

export interface PersonProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  permissionRole: string;
  hierarchyRole: string;
  department?: string | null;
  title?: string | null;
  managerId?: string | null;
  isActive: boolean;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}
