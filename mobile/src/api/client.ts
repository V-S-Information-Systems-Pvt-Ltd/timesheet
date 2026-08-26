import type {
  ApiResult,
  MobileActor,
  MobileConfig,
  MobileDashboardData,
  MobileLoginData,
  MobileLoginInput,
  MobileReferenceData,
  MobileTokenPair,
  TimesheetListParams,
  TimesheetListResult,
} from './contracts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiClientError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const extractedMessage =
      body && typeof body === 'object' && 'error' in body && (body as { error?: { message?: string } }).error?.message
        ? (body as { error: { message: string } }).error.message
        : `API request failed with status ${status}.`;
    super(extractedMessage);
    this.name = 'ApiClientError';
    this.status = status;
    this.body = body;
  }

  get code(): string | undefined {
    if (this.body && typeof this.body === 'object' && 'error' in this.body) {
      return (this.body as { error?: { code?: string } }).error?.code;
    }
    return undefined;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('An API base URL is required.');
  return normalized;
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly fetcher: FetchLike;

  constructor(baseUrl: string, fetcher: FetchLike = fetch) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetcher = fetcher;
  }

  async getConfig(): Promise<MobileConfig> {
    const result = await this.request<MobileConfig>('/api/v1/config');
    return this.unwrap(result, 200);
  }

  async login(input: MobileLoginInput): Promise<MobileLoginData> {
    const result = await this.request<MobileLoginData>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return this.unwrap(result, 200);
  }

  async refresh(refreshToken: string): Promise<MobileTokenPair> {
    const result = await this.request<MobileTokenPair>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
    return this.unwrap(result, 200);
  }

  async getMe(accessToken: string): Promise<MobileActor> {
    const result = await this.request<MobileActor>('/api/v1/auth/me', undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async getDashboard(accessToken: string): Promise<MobileDashboardData> {
    const result = await this.request<MobileDashboardData>('/api/v1/dashboard', undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async listTimesheets(accessToken: string, params?: TimesheetListParams): Promise<TimesheetListResult> {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params?.dateTo) searchParams.set('dateTo', params.dateTo);
    if (params?.userId) searchParams.set('userId', params.userId);

    const query = searchParams.toString();
    const path = `/api/v1/timesheets${query ? `?${query}` : ''}`;
    const result = await this.request<TimesheetListResult>(path, undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async getReference(accessToken: string): Promise<MobileReferenceData> {
    const result = await this.request<MobileReferenceData>('/api/v1/reference', undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async logout(accessToken: string): Promise<void> {
    const result = await this.request<{ ok: true }>('/api/v1/auth/logout', { method: 'POST' }, accessToken);
    this.unwrap(result, 200);
  }

  async logoutAll(accessToken: string): Promise<void> {
    const result = await this.request<{ ok: true }>('/api/v1/auth/logout-all', { method: 'POST' }, accessToken);
    this.unwrap(result, 200);
  }

  private unwrap<T>(result: ApiResult<T>, status: number): T {
    if (result.error || result.data === null) throw new ApiClientError(status, result);
    return result.data;
  }

  private async request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<ApiResult<T>> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = { data: null, error: { message: 'The server returned an invalid response.' } };
    }

    if (!response.ok) throw new ApiClientError(response.status, body);

    if (!body || typeof body !== 'object' || !('data' in body) || !('error' in body)) {
      throw new ApiClientError(response.status, body);
    }

    const result = body as ApiResult<T>;
    if (result.error) throw new ApiClientError(response.status, result);
    return result;
  }
}
