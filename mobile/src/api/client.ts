import type {
  ApiErrorCode,
  ApiResult,
  MobileActor,
  MobileConfig,
  MobileDashboardData,
  MobileLoginData,
  MobileLoginInput,
  MobileReferenceData,
  MobileTimesheetQuery,
  MobileTimesheetsPage,
  MobileTokenPair,
} from './contracts';

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly body: unknown;
  readonly fieldErrors?: Record<string, string[]>;
  /** Present on RATE_LIMITED responses (Retry-After header). */
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options: { body?: unknown; fieldErrors?: Record<string, string[]>; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.body = options.body;
    this.fieldErrors = options.fieldErrors;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** Error codes that mean "the presented access token is not usable". */
const TOKEN_REJECTED_CODES = new Set([
  'ACCESS_TOKEN_EXPIRED',
  'AUTH_REQUIRED',
  'SESSION_REVOKED',
]);

/** Error codes that mean the whole device session must be dropped locally. */
const SESSION_LOST_CODES = new Set([
  'INVALID_REFRESH_TOKEN',
  'REFRESH_TOKEN_REUSED',
  'SESSION_REVOKED',
]);

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('An API base URL is required.');
  if (!/^https:\/\//i.test(normalized) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) {
    throw new Error('Only HTTPS base URLs are allowed in production.');
  }
  return normalized;
}

/**
 * Pluggable auth surface. The session controller supplies live access-token
 * state so the client can attach bearer headers and recover once from a 401
 * through a single-flight refresh.
 */
export interface AuthHooks {
  getAccessToken(): string | null;
  refreshAccessToken(): Promise<string>;
  /** Called when the server rejects even the refreshed session. */
  onSessionLost(): void;
}

export interface ApiClientOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiClient {
  private baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;
  private authHooks: AuthHooks | null = null;
  /** Single-flight guard shared by every concurrent 401 recovery. */
  private refreshPromise: Promise<string> | null = null;

  constructor(baseUrl: string, fetcher: FetchLike = fetch, options: ApiClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetcher = fetcher;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  setAuthHooks(hooks: AuthHooks | null): void {
    this.authHooks = hooks;
  }

  /** Re-points the client at an approved server (server-entry flow). */
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async getConfig(): Promise<MobileConfig> {
    const result = await this.request<MobileConfig>('/api/v1/config');
    return this.unwrap(result);
  }

  async login(input: MobileLoginInput): Promise<MobileLoginData> {
    const result = await this.request<MobileLoginData>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return this.unwrap(result);
  }

  async refresh(refreshToken: string): Promise<MobileTokenPair> {
    const result = await this.request<MobileTokenPair>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
    return this.unwrap(result);
  }

  async getMe(): Promise<MobileActor> {
    const result = await this.request<MobileActor>('/api/v1/auth/me');
    return this.unwrap(result);
  }

  async getDashboard(): Promise<MobileDashboardData> {
    const result = await this.request<MobileDashboardData>('/api/v1/dashboard');
    return this.unwrap(result);
  }

  async getTimesheets(query: MobileTimesheetQuery = {}): Promise<MobileTimesheetsPage> {
    const params = new URLSearchParams();
    if (query.from !== undefined) params.set('from', String(query.from));
    if (query.to !== undefined) params.set('to', String(query.to));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.userId) params.set('userId', query.userId);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
    const qs = params.toString();
    const result = await this.request<MobileTimesheetsPage>(`/api/v1/timesheets${qs ? `?${qs}` : ''}`);
    return this.unwrap(result);
  }

  async getReference(): Promise<MobileReferenceData> {
    const result = await this.request<MobileReferenceData>('/api/v1/reference');
    return this.unwrap(result);
  }

  async logout(): Promise<void> {
    const result = await this.request<{ ok: true }>('/api/v1/auth/logout', { method: 'POST' });
    this.unwrap(result);
  }

  async logoutAll(): Promise<void> {
    const result = await this.request<{ ok: true }>('/api/v1/auth/logout-all', { method: 'POST' });
    this.unwrap(result);
  }

  private unwrap<T>(result: ApiResult<T>): T {
    if (result.error) {
      throw new ApiClientError(
        result.error.code === 'VALIDATION_ERROR' ? 400 : 0,
        result.error.code ?? 'INTERNAL_ERROR',
        result.error.message,
        { body: result, fieldErrors: result.error.fieldErrors },
      );
    }
    return result.data;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    allowRefreshRetry = true,
  ): Promise<ApiResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...this.bearerHeader(path),
          ...(init.headers ?? {}),
        },
      });
    } catch (reason) {
      if (reason instanceof Error && reason.name === 'AbortError') {
        throw new ApiClientError(0, 'TIMEOUT', 'The server took too long to respond.');
      }
      throw new ApiClientError(0, 'NETWORK_ERROR', 'Could not reach the server.');
    } finally {
      clearTimeout(timer);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = { data: null, error: { code: 'INTERNAL_ERROR', message: 'The server returned an invalid response.' } };
    }

    if (!response.ok) {
      const error = this.toError(response.status, body, response.headers);
      if (
        allowRefreshRetry &&
        TOKEN_REJECTED_CODES.has(error.code) &&
        this.authHooks &&
        !path.startsWith('/api/v1/auth/')
      ) {
        // One-time recovery: refresh once, then replay the request once.
        // singleFlightRefresh reports session loss for fatal refresh codes.
        await this.singleFlightRefresh();
        return this.request<T>(path, init, false);
      }
      throw error;
    }

    if (!body || typeof body !== 'object' || !('data' in body) || !('error' in body)) {
      throw new ApiClientError(response.status, 'INTERNAL_ERROR', 'Unexpected server envelope.', { body });
    }

    const result = body as ApiResult<T>;
    if (result.error) throw this.toError(response.status, body, response.headers);
    return result;
  }

  private bearerHeader(path: string): Record<string, string> {
    const hooks = this.authHooks;
    if (!hooks) return {};
    // Login/refresh/config are public; never send stale credentials to them.
    if (
      path === '/api/v1/config' ||
      path === '/api/v1/auth/login' ||
      path === '/api/v1/auth/refresh'
    ) {
      return {};
    }
    const token = hooks.getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async singleFlightRefresh(): Promise<string> {
    const hooks = this.authHooks;
    if (!hooks) throw new ApiClientError(401, 'AUTH_REQUIRED', 'No authenticated session is available.');
    if (!this.refreshPromise) {
      this.refreshPromise = hooks
        .refreshAccessToken()
        .catch((reason: unknown) => {
          if (
            reason instanceof ApiClientError &&
            SESSION_LOST_CODES.has(reason.code)
          ) {
            hooks.onSessionLost();
          }
          throw reason;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }
    return this.refreshPromise;
  }

  private toError(status: number, body: unknown, headers?: Headers): ApiClientError {
    const errorBody =
      body && typeof body === 'object' && 'error' in body
        ? ((body as { error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> } }).error ?? {})
        : {};
    const retryAfterRaw = headers?.get('Retry-After') ?? undefined;
    const retryAfterSeconds =
      retryAfterRaw !== undefined && /^\d+$/.test(retryAfterRaw) ? Number(retryAfterRaw) : undefined;
    return new ApiClientError(status, errorBody.code ?? 'INTERNAL_ERROR', errorBody.message ?? 'The request failed.', {
      body,
      fieldErrors: errorBody.fieldErrors,
      retryAfterSeconds,
    });
  }
}
