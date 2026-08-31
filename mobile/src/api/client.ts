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
  BatchDeleteTimesheetsResponse,
  BatchDuplicateItem,
  BatchDuplicateTimesheetsResponse,
  GlobalReminderItem,
  UpdateProfileInput,
  SignupInput,
  SignupResult,
  MobileLayout,
  MobileLayoutResponse,
  WorkspaceBranding,
  ProjectAdminItem,
  CreateProjectInput,
  UpdateProjectInput,
  ActivityTypeAdminItem,
  CreateActivityTypeInput,
  UpdateActivityTypeInput,
  CreateAdminUserInput,
  UpdateAdminUserInput,
  TitleAdminItem,
  CreateTitleInput,
  ReclassifyTitleInput,
  TitleImpactInfo,
  BackfillSettings,
  CreateAdminLeaveInput,
  CreateGlobalReminderInput,
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
    if (params?.from !== undefined) searchParams.set('from', String(params.from));
    if (params?.to !== undefined) searchParams.set('to', String(params.to));
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

  async deleteTimesheets(accessToken: string, ids: string[]): Promise<BatchDeleteTimesheetsResponse> {
    try {
      const result = await this.request<BatchDeleteTimesheetsResponse>('/api/v1/timesheets/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }, accessToken);
      return this.unwrap(result, 200);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        const results: Array<{ id: string; success: boolean; error?: string }> = [];
        let deletedCount = 0;
        for (const id of ids) {
          try {
            await this.deleteTimesheet(accessToken, id);
            results.push({ id, success: true });
            deletedCount++;
          } catch (e) {
            results.push({ id, success: false, error: e instanceof Error ? e.message : 'Delete failed' });
          }
        }
        return { results, deletedCount };
      }
      throw err;
    }
  }

  async duplicateTimesheet(accessToken: string, id: string, targetDate?: string): Promise<{ success: boolean; entry: TimesheetEntry }> {
    const result = await this.request<{ success: boolean; entry: TimesheetEntry }>(`/api/v1/timesheets/${id}/duplicate`, {
      method: 'POST',
      body: targetDate ? JSON.stringify({ targetDate }) : undefined,
    }, accessToken);
    return this.unwrap(result, 201);
  }

  async duplicateTimesheets(accessToken: string, items: BatchDuplicateItem[]): Promise<BatchDuplicateTimesheetsResponse> {
    try {
      const result = await this.request<BatchDuplicateTimesheetsResponse>('/api/v1/timesheets/batch-duplicate', {
        method: 'POST',
        body: JSON.stringify({ items }),
      }, accessToken);
      return this.unwrap(result, 200);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        const results: Array<{ id: string; success: boolean; entry?: TimesheetEntry; error?: string }> = [];
        let duplicatedCount = 0;
        for (const item of items) {
          try {
            const res = await this.duplicateTimesheet(accessToken, item.id, item.targetDate);
            results.push({ id: item.id, success: true, entry: res.entry });
            duplicatedCount++;
          } catch (e) {
            results.push({ id: item.id, success: false, error: e instanceof Error ? e.message : 'Duplicate failed' });
          }
        }
        return { results, duplicatedCount };
      }
      throw err;
    }
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
    if (params?.user || params?.userId) searchParams.set('user', (params.user || params.userId)!);
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.groupBy) searchParams.set('groupBy', params.groupBy);
    const query = searchParams.toString();
    const path = `/api/v1/reports${query ? `?${query}` : ''}`;
    const result = await this.request<ReportTotals>(path, undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async exportReportsCsv(accessToken: string, params?: ReportParams): Promise<string> {
    const searchParams = new URLSearchParams();
    if (params?.project) searchParams.set('project', params.project);
    if (params?.user || params?.userId) searchParams.set('user', (params.user || params.userId)!);
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    const query = searchParams.toString();
    const url = `${this.baseUrl}/api/v1/reports/export${query ? `?${query}` : ''}`;
    const response = await this.fetcher(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      let errorMsg = `Export failed (${response.status})`;
      try {
        const json = JSON.parse(text);
        if (json?.error?.message) errorMsg = json.error.message;
        else if (json?.error) errorMsg = json.error;
      } catch {
        // ignore parse error
      }
      throw new ApiClientError(response.status, { error: { message: errorMsg } });
    }
    return response.text();
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

  async updateProfile(accessToken: string, input: UpdateProfileInput): Promise<MobileActor> {
    const result = await this.request<MobileActor>(
      '/api/v1/auth/me',
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async listGlobalReminders(accessToken: string): Promise<GlobalReminderItem[]> {
    const result = await this.request<GlobalReminderItem[]>('/api/v1/reminders/global', undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async dismissGlobalReminder(accessToken: string, id: string): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>(
      `/api/v1/reminders/global/${id}/dismiss`,
      { method: 'POST' },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async signup(input: SignupInput): Promise<SignupResult> {
    const result = await this.request<SignupResult>('/api/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return this.unwrap(result, 201);
  }

  async getLayout(accessToken: string): Promise<MobileLayoutResponse> {
    const result = await this.request<MobileLayoutResponse>('/api/v1/layout', undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async updateLayout(
    layout: MobileLayout,
    accessToken: string
  ): Promise<{ layout: MobileLayout; savedLayout: MobileLayout | null }> {
    const result = await this.request<{ layout: MobileLayout; savedLayout: MobileLayout | null }>(
      '/api/v1/layout',
      {
        method: 'PUT',
        body: JSON.stringify({ layout }),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async resetLayout(accessToken: string): Promise<{ layout: MobileLayout; savedLayout: null }> {
    const result = await this.request<{ layout: MobileLayout; savedLayout: null }>(
      '/api/v1/layout',
      {
        method: 'PUT',
        body: JSON.stringify({ reset: true }),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async getAdminDefaultLayout(accessToken: string): Promise<{ layout: MobileLayout }> {
    const result = await this.request<{ layout: MobileLayout }>(
      '/api/v1/admin/layout',
      undefined,
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async updateAdminDefaultLayout(
    layout: MobileLayout,
    accessToken: string
  ): Promise<{ layout: MobileLayout }> {
    const result = await this.request<{ layout: MobileLayout }>(
      '/api/v1/admin/layout',
      {
        method: 'PUT',
        body: JSON.stringify({ layout }),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async resetAdminDefaultLayout(accessToken: string): Promise<{ layout: MobileLayout }> {
    const result = await this.request<{ layout: MobileLayout }>(
      '/api/v1/admin/layout',
      {
        method: 'PUT',
        body: JSON.stringify({ reset: true }),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async getBranding(accessToken: string): Promise<WorkspaceBranding> {
    const result = await this.request<WorkspaceBranding>('/api/v1/admin/branding', undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async updateBranding(
    branding: WorkspaceBranding,
    accessToken: string
  ): Promise<WorkspaceBranding> {
    const result = await this.request<WorkspaceBranding>(
      '/api/v1/admin/branding',
      {
        method: 'PUT',
        body: JSON.stringify({ branding }),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async resetBranding(accessToken: string): Promise<WorkspaceBranding> {
    const result = await this.request<WorkspaceBranding>(
      '/api/v1/admin/branding',
      {
        method: 'PUT',
        body: JSON.stringify({ reset: true }),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async listAdminProjects(accessToken: string): Promise<ProjectAdminItem[]> {
    const result = await this.request<ProjectAdminItem[]>('/api/v1/admin/projects', undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async createAdminProject(
    input: CreateProjectInput,
    accessToken: string
  ): Promise<ProjectAdminItem> {
    const result = await this.request<ProjectAdminItem>(
      '/api/v1/admin/projects',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      accessToken
    );
    return this.unwrap(result, 201);
  }

  async updateAdminProject(
    id: string,
    input: UpdateProjectInput,
    accessToken: string
  ): Promise<ProjectAdminItem> {
    const result = await this.request<ProjectAdminItem>(
      `/api/v1/admin/projects/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async deleteAdminProject(id: string, accessToken: string): Promise<{ success: boolean; id: string }> {
    const result = await this.request<{ success: boolean; id: string }>(
      `/api/v1/admin/projects/${id}`,
      {
        method: 'DELETE',
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async listAdminActivityTypes(accessToken: string): Promise<ActivityTypeAdminItem[]> {
    const result = await this.request<ActivityTypeAdminItem[]>('/api/v1/admin/activity-types', undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async createAdminActivityType(
    input: CreateActivityTypeInput,
    accessToken: string
  ): Promise<ActivityTypeAdminItem> {
    const result = await this.request<ActivityTypeAdminItem>(
      '/api/v1/admin/activity-types',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      accessToken
    );
    return this.unwrap(result, 201);
  }

  async updateAdminActivityType(
    id: string,
    input: UpdateActivityTypeInput,
    accessToken: string
  ): Promise<ActivityTypeAdminItem> {
    const result = await this.request<ActivityTypeAdminItem>(
      `/api/v1/admin/activity-types/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async deleteAdminActivityType(id: string, accessToken: string): Promise<{ success: boolean; id: string }> {
    const result = await this.request<{ success: boolean; id: string }>(
      `/api/v1/admin/activity-types/${id}`,
      {
        method: 'DELETE',
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async listAdminUsers(accessToken: string): Promise<PersonProfile[]> {
    const result = await this.request<PersonProfile[]>('/api/v1/admin/users', undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async createAdminUser(
    input: CreateAdminUserInput,
    accessToken: string
  ): Promise<PersonProfile> {
    const result = await this.request<PersonProfile>(
      '/api/v1/admin/users',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      accessToken
    );
    return this.unwrap(result, 201);
  }

  async updateAdminUser(
    id: string,
    input: UpdateAdminUserInput,
    accessToken: string
  ): Promise<PersonProfile> {
    const result = await this.request<PersonProfile>(
      `/api/v1/admin/users/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async listAdminTitles(accessToken: string): Promise<TitleAdminItem[]> {
    const result = await this.request<TitleAdminItem[]>('/api/v1/admin/titles', undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async createAdminTitle(
    input: CreateTitleInput,
    accessToken: string
  ): Promise<TitleAdminItem> {
    const result = await this.request<TitleAdminItem>(
      '/api/v1/admin/titles',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      accessToken
    );
    return this.unwrap(result, 201);
  }

  async getAdminTitleImpact(
    name: string,
    proposedRole: string,
    accessToken: string
  ): Promise<TitleImpactInfo> {
    const result = await this.request<TitleImpactInfo>(
      `/api/v1/admin/titles/impact?name=${encodeURIComponent(name)}&proposedRole=${encodeURIComponent(proposedRole)}`,
      undefined,
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async reclassifyAdminTitle(
    input: ReclassifyTitleInput,
    accessToken: string
  ): Promise<{ name: string; hierarchyRole: string; affectedCount?: number }> {
    const result = await this.request<{ name: string; hierarchyRole: string; affectedCount?: number }>(
      '/api/v1/admin/titles',
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async deleteAdminTitle(name: string, accessToken: string): Promise<{ success: boolean; name: string }> {
    const result = await this.request<{ success: boolean; name: string }>(
      `/api/v1/admin/titles?name=${encodeURIComponent(name)}`,
      {
        method: 'DELETE',
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async getBackfillSettings(accessToken: string): Promise<BackfillSettings> {
    const result = await this.request<BackfillSettings>(
      '/api/v1/admin/settings/backfill',
      undefined,
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async updateBackfillSettings(settings: BackfillSettings, accessToken: string): Promise<BackfillSettings> {
    const result = await this.request<BackfillSettings>(
      '/api/v1/admin/settings/backfill',
      {
        method: 'PUT',
        body: JSON.stringify(settings),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async listAdminLeaves(
    params?: { userId?: string; from?: string; to?: string },
    accessToken?: string
  ): Promise<LeaveRow[]> {
    const searchParams = new URLSearchParams();
    if (params?.userId) searchParams.set('userId', params.userId);
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    const query = searchParams.toString();
    const path = `/api/v1/admin/leaves${query ? `?${query}` : ''}`;
    const result = await this.request<LeaveRow[]>(path, undefined, accessToken);
    return this.unwrap(result, 200);
  }

  async createAdminLeave(
    input: CreateAdminLeaveInput,
    accessToken: string
  ): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>(
      '/api/v1/admin/leaves',
      {
        method: 'POST',
        body: JSON.stringify({
          rows: [
            {
              userId: input.userId,
              leaveDate: input.date,
              reason: input.reason || '',
            },
          ],
        }),
      },
      accessToken
    );
    return this.unwrap(result, 201);
  }

  async deleteAdminLeave(id: string, accessToken: string): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>(
      `/api/v1/admin/leaves/${id}`,
      {
        method: 'DELETE',
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async listAllGlobalReminders(accessToken: string): Promise<GlobalReminderItem[]> {
    const result = await this.request<GlobalReminderItem[]>(
      '/api/v1/admin/global-reminders',
      undefined,
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async createAdminGlobalReminder(
    input: CreateGlobalReminderInput,
    accessToken: string
  ): Promise<GlobalReminderItem> {
    const result = await this.request<GlobalReminderItem>(
      '/api/v1/admin/global-reminders',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      accessToken
    );
    return this.unwrap(result, 201);
  }

  async updateAdminGlobalReminder(
    id: string,
    input: Partial<CreateGlobalReminderInput>,
    accessToken: string
  ): Promise<{ success: boolean; id: string }> {
    const result = await this.request<{ success: boolean; id: string }>(
      `/api/v1/admin/global-reminders/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      accessToken
    );
    return this.unwrap(result, 200);
  }

  async deleteAdminGlobalReminder(id: string, accessToken: string): Promise<{ success: boolean; id: string }> {
    const result = await this.request<{ success: boolean; id: string }>(
      `/api/v1/admin/global-reminders/${id}`,
      {
        method: 'DELETE',
      },
      accessToken
    );
    return this.unwrap(result, 200);
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
