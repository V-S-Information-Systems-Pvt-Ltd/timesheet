import { ApiClient } from '../src/api/client';

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

  it('preserves structured error responses for non-2xx results', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      response(503, { data: null, error: { code: 'unavailable', message: 'Try again later.' } })
    );
    const client = new ApiClient('https://timesheet.example', fetcher);

    await expect(client.getConfig()).rejects.toEqual(
      expect.objectContaining({ status: 503, body: expect.any(Object) })
    );
  });
});
