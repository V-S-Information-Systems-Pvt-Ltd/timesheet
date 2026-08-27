import type {
  ApiResult,
  ChangePasswordInput,
  CreateLeaveInput,
  CreateReminderInput,
  CreateTimesheetInput,
  LeaveRow,
  MobileActor,
  MobileConfig,
  MobileDashboardData,
  MobileLoginData,
  MobileLoginInput,
  MobileReferenceData,
  MobileTokenPair,
  PersonProfile,
  ReminderItem,
  ReportParams,
  ReportTotals,
  TimesheetListParams,
  TimesheetListResult,
  TimesheetEntry,
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
  private readonly timeoutMs: number;
  private onTokenRefresh?: () => Promise<string>;

  constructor(baseUrl: string, fetcher: FetchLike = fetch, timeoutMs = 15000) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
  }

  setTokenRefreshHandler(handler: () => Promise<string>): void {
    this.onTokenRefresh = handler;
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

  async createTimesheet(accessToken: string, input: CreateTimesheetInput): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>('/api/v1/timesheets', {
      method: 'POST',
      body: JSON.stringify(input),
    }, accessToken);
    return this.unwrap(result, 201);
  }

  async updateTimesheet(accessToken: string, id: string, input: CreateTimesheetInput): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>(`/api/v1/timesheets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }, accessToken);
    return this.unwrap(result, 200);
  }

  async deleteTimesheet(accessToken: string, id: string): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>(`/api/v1/timesheets/${id}`, {
      method: 'DELETE',
    }, accessToken);
    return this.unwrap(result, 200);
  }

  async duplicateTimesheet(accessToken: string, id: string, targetDate?: string): Promise<{ success: boolean; entry: TimesheetEntry }> {
    const result = await this.request<{ success: boolean; entry: TimesheetEntry }>(`/api/v1/timesheets/${id}/duplicate`, {
      method: 'POST',
      body: targetDate ? JSON.stringify({ targetDate }) : undefined,
    }, accessToken);
    return this.unwrap(result, 201);
  }

  async listLeaves(accessToken: string, params?: { from?: string; to?: string; userId?: string }): Promise<LeaveRow[]> {
    const searchParams = new URLSearchParams();
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.userId) searchParams.set('userId', params.userId);
    const query = searchParams.toString();
    const path = `/api/v1/leaves${query ? `?${query}` : ''}`;
    const result = await this.request<LeaveRow[]>(path, undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async createLeave(accessToken: string, input: CreateLeaveInput): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>('/api/v1/leaves', {
      method: 'POST',
      body: JSON.stringify({ rows: [input] }),
    }, accessToken);
    return this.unwrap(result, 201);
  }

  async deleteLeave(accessToken: string, id: string): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>(`/api/v1/leaves/${id}`, {
      method: 'DELETE',
    }, accessToken);
    return this.unwrap(result, 200);
  }

  async listReminders(accessToken: string): Promise<ReminderItem[]> {
    const result = await this.request<ReminderItem[]>('/api/v1/reminders', undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async createReminder(accessToken: string, input: CreateReminderInput): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>('/api/v1/reminders', {
      method: 'POST',
      body: JSON.stringify(input),
    }, accessToken);
    return this.unwrap(result, 201);
  }

  async updateReminder(accessToken: string, id: string, done: boolean): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>(`/api/v1/reminders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ done }),
    }, accessToken);
    return this.unwrap(result, 200);
  }

  async deleteReminder(accessToken: string, id: string): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>(`/api/v1/reminders/${id}`, {
      method: 'DELETE',
    }, accessToken);
    return this.unwrap(result, 200);
  }

  async getReports(accessToken: string, params?: ReportParams): Promise<ReportTotals> {
    const searchParams = new URLSearchParams();
    if (params?.project) searchParams.set('project', params.project);
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.groupBy) searchParams.set('groupBy', params.groupBy);
    const query = searchParams.toString();
    const path = `/api/v1/reports${query ? `?${query}` : ''}`;
    const result = await this.request<ReportTotals>(path, undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async listPeople(accessToken: string): Promise<PersonProfile[]> {
    const result = await this.request<PersonProfile[]>('/api/v1/people', undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async changePassword(accessToken: string, input: ChangePasswordInput): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(input),
    }, accessToken);
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

  private async request<T>(
    path: string,
    init?: RequestInit,
    accessToken?: string,
    isRetry = false
  ): Promise<ApiResult<T>> {
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      timer = setTimeout(() => {
        controller?.abort();
      }, this.timeoutMs);
    }

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller?.signal ?? init?.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = { data: null, error: { message: 'The server returned an invalid response.' } };
    }

    // Single-flight 401 retry if refresh handler is wired and request carried an access token
    if (response.status === 401 && accessToken && !isRetry && this.onTokenRefresh) {
      try {
        const nextAccessToken = await this.onTokenRefresh();
        return this.request<T>(path, init, nextAccessToken, true);
      } catch {
        // Refresh failed, fall through to throw original 401
      }
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
