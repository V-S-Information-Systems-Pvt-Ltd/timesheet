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

export interface MobileDashboardData {
  actor: MobileActor;
  today: { date: string; hours: number };
  week: { from: string; to: string; hours: number };
  recentEntries: Array<Record<string, unknown>>;
  quickActions: string[];
}
