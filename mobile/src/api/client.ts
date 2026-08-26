import type { ApiResult, MobileConfig } from './contracts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiClientError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}.`);
    this.name = 'ApiClientError';
    this.status = status;
    this.body = body;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('An API base URL is required.');
  return normalized;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;

  constructor(baseUrl: string, fetcher: FetchLike = fetch) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetcher = fetcher;
  }

  async getConfig(): Promise<MobileConfig> {
    const result = await this.request<MobileConfig>('/api/v1/config');
    if (result.error) throw new ApiClientError(200, result);
    return result.data;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
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

    return body as ApiResult<T>;
  }
}
