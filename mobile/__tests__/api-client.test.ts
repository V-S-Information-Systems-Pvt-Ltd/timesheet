import { ApiClient, ApiClientError } from '../src/api/client';

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface HooksOptions {
  accessToken?: string | null;
  refreshedToken?: string;
  refreshError?: Error;
  onSessionLost?: () => void;
}

function installHooks(client: ApiClient, options: HooksOptions = {}) {
  let currentToken: string | null = options.accessToken ?? null;
  const refresh = jest.fn(() => {
    if (options.refreshError) return Promise.reject(options.refreshError);
    currentToken = options.refreshedToken ?? 'refreshed-token';
    return Promise.resolve(currentToken);
  });
  const onSessionLost = options.onSessionLost ?? jest.fn();
  client.setAuthHooks({
    getAccessToken: () => currentToken,
    refreshAccessToken: refresh,
    onSessionLost,
  });
  return { refresh, onSessionLost };
}

describe('ApiClient', () => {
  it('normalizes the base URL and reads the public server config', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      response(200, {
        data: {
          apiVersion: 1,
          appVersion: '0.1.0',
          backend: 'native',
          capabilities: { bearerAuth: false, mobileApi: true },
        },
        error: null,
      })
    );

    const client = new ApiClient('https://timesheet.example///', fetcher);
    await expect(client.getConfig()).resolves.toMatchObject({ backend: 'native' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://timesheet.example/api/v1/config',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) })
    );
  });

  it('rejects empty base URLs before making a request', () => {
    expect(() => new ApiClient('  ')).toThrow('An API base URL is required.');
  });

  it('rejects insecure base URLs outside local development', () => {
    expect(() => new ApiClient('http://insecure.example')).toThrow(/HTTPS/);
    expect(() => new ApiClient('http://localhost:3000')).not.toThrow();
  });

  it('surfaces stable error codes from error envelopes', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      response(401, { data: null, error: { code: 'INVALID_CREDENTIALS', message: 'Nope.' } })
    );
    const client = new ApiClient('https://timesheet.example', fetcher);

    await expect(client.login({ email: 'u@example.com', password: 'bad' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Nope.',
    });
  });

  it('injects bearer tokens into protected requests only', async () => {
    const fetcher = jest.fn(async (_input: string, init?: RequestInit) => {
      void init;
      return response(200, { data: { ok: true }, error: null });
    });
    const client = new ApiClient('https://timesheet.example', fetcher);
    installHooks(client, { accessToken: 'access-token' });

    await expect(client.getMe()).resolves.toMatchObject({ ok: true });
    await client.login({ email: 'u@example.com', password: 'pw' });
    await client.getConfig();

    const headersOf = (call: number) => (fetcher.mock.calls[call]?.[1] as RequestInit).headers as Record<string, string>;
    // Protected endpoint carries the token; public endpoints never do.
    expect(headersOf(0).Authorization).toBe('Bearer access-token');
    expect(headersOf(1).Authorization).toBeUndefined();
    expect(headersOf(2).Authorization).toBeUndefined();
  });

  it('recovers once from an expired access token through a shared refresh', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(
        response(401, { data: null, error: { code: 'ACCESS_TOKEN_EXPIRED', message: 'Expired.' } })
      )
      .mockResolvedValue(response(200, { data: { today: { date: '2026-08-26', hours: 0 }, week: { from: '', to: '', hours: 0 }, recentEntries: [], quickActions: [], actor: { id: 'u1', email: 'e', role: 'user', permissionRole: 'user', hierarchyRole: 'user', isActive: true } }, error: null }));
    const client = new ApiClient('https://timesheet.example', fetcher);
    const { refresh, onSessionLost } = installHooks(client, { accessToken: 'stale' });

    await expect(client.getDashboard()).resolves.toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onSessionLost).not.toHaveBeenCalled();
    // The retry must carry the refreshed token.
    const retryHeaders = (fetcher.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer refreshed-token');
  });

  it('joins concurrent recoveries onto one in-flight refresh', async () => {
    let calls = 0;
    const fetcher = jest.fn(async () => {
      calls += 1;
      if (calls <= 2) {
        return response(401, { data: null, error: { code: 'ACCESS_TOKEN_EXPIRED', message: 'Expired.' } });
      }
      return response(200, { data: { ok: true }, error: null });
    });
    const client = new ApiClient('https://timesheet.example', fetcher);
    const { refresh } = installHooks(client, {
      accessToken: 'stale',
      refreshedToken: 'shared',
    });

    await Promise.all([client.getDashboard(), client.getDashboard()]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reports session loss when the server rejects the refreshed token', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      response(401, { data: null, error: { code: 'ACCESS_TOKEN_EXPIRED', message: 'Expired.' } })
    );
    const client = new ApiClient('https://timesheet.example', fetcher);
    const onSessionLost = jest.fn();
    const { refresh } = installHooks(client, {
      accessToken: 'stale',
      refreshError: new ApiClientError(401, 'REFRESH_TOKEN_REUSED', 'Reuse detected.'),
      onSessionLost,
    });

    await expect(client.getDashboard()).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it('never falls back to cookies or retries after a rejected replay', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(
        response(401, { data: null, error: { code: 'SESSION_REVOKED', message: 'Revoked.' } })
      )
      .mockResolvedValueOnce(
        response(401, { data: null, error: { code: 'SESSION_REVOKED', message: 'Revoked.' } })
      );
    const client = new ApiClient('https://timesheet.example', fetcher);
    installHooks(client, { accessToken: 'stale' });

    await expect(client.getDashboard()).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('maps aborted requests to a TIMEOUT error', async () => {
    const slowFetcher = (_input: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('Aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    const client = new ApiClient('https://timesheet.example', slowFetcher, { timeoutMs: 5 });
    await expect(client.getConfig()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('serializes timesheet query parameters', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValue(response(200, { data: { rows: [], count: 0 }, error: null }));
    const client = new ApiClient('https://timesheet.example', fetcher);

    await client.getTimesheets({ from: 20, to: 39, dateFrom: '2026-08-01', dateTo: '2026-08-26' });
    const url = fetcher.mock.calls[0]?.[0] as string;
    expect(url).toBe(
      'https://timesheet.example/api/v1/timesheets?from=20&to=39&dateFrom=2026-08-01&dateTo=2026-08-26'
    );
  });
});
