export type MobileBackend = 'supabase' | 'native';

export type MobilePlatform = 'android' | 'ios' | 'windows';

export interface MobileConfig {
  apiVersion: 1;
  appVersion: string;
  backend: MobileBackend;
  capabilities: {
    bearerAuth: boolean;
    mobileApi: boolean;
  };
}

/** Stable error codes from /api/v1. Client logic branches on these only. */
export type ApiErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_INACTIVE'
  | 'AUTH_REQUIRED'
  | 'ACCESS_TOKEN_EXPIRED'
  | 'INVALID_REFRESH_TOKEN'
  | 'REFRESH_TOKEN_REUSED'
  | 'SESSION_REVOKED'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'API_VERSION_UNSUPPORTED'
  | 'INTERNAL_ERROR'
  | string;

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
  platform?: MobilePlatform;
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

/** One work entry as returned by /api/v1/dashboard and /api/v1/timesheets. */
export interface MobileTimesheetEntry {
  id: string;
  user_id: string;
  project_id: string;
  activity_type_id: string | null;
  log_date: string;
  hours_worked: number;
  work_done: string;
  created_at: string;
  projects?: { name: string } | null;
  profiles?: { email: string } | null;
  activity_types?: { name: string } | null;
}

export interface MobileTimesheetsPage {
  rows: MobileTimesheetEntry[];
  count: number;
}

export interface MobileTimesheetQuery {
  /** 0-based offset. */
  from?: number;
  /** Inclusive end offset. */
  to?: number;
  limit?: number;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface MobileReferenceData {
  projects: Array<{
    id: string;
    name: string;
    so_number: string | null;
    telegram_no: number | null;
    created_at: string;
  }>;
  activityTypes: Array<{
    id: string;
    name: string;
    is_active: boolean;
    telegram_no: number | null;
    created_at: string;
  }>;
}

export interface MobileDashboardData {
  actor: MobileActor;
  today: { date: string; hours: number };
  week: { from: string; to: string; hours: number };
  recentEntries: MobileTimesheetEntry[];
  quickActions: string[];
}
