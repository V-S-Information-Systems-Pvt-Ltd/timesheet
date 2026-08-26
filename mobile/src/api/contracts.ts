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

export interface MobileActor {
  id: string;
  email: string;
  role: string;
  permissionRole: string;
  hierarchyRole: string;
  isActive: boolean;
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
  project_id: string;
  project_name?: string;
  activity_type_id: string;
  activity_name?: string;
  log_date: string;
  hours_worked: number | string;
  notes?: string | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
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
  code?: string;
  status?: string;
}

export interface ActivityTypeItem {
  id: string;
  name: string;
  code?: string;
}

export interface MobileReferenceData {
  projects: ProjectItem[];
  activityTypes: ActivityTypeItem[];
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
  total?: number;
}
