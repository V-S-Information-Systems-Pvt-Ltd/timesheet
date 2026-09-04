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

  it('sends bearer tokens only to protected requests', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      response(200, { data: { id: 'u1', email: 'u@example.com' }, error: null }),
    );
    const client = new ApiClient('https://timesheet.example', fetcher);

    await expect(client.getMe('access-token')).resolves.toMatchObject({ id: 'u1' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://timesheet.example/api/v1/auth/me',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );
  });

  it('serializes numeric from and to range pagination parameters in listTimesheets', async () => {
    const fetcher = jest.fn().mockImplementation(() =>
      Promise.resolve(response(200, { data: { rows: [], count: 0 }, error: null }))
    );
    const client = new ApiClient('https://timesheet.example', fetcher);

    await client.listTimesheets('access-token', { from: 0, to: 49, limit: 50, dateFrom: '2026-08-01' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://timesheet.example/api/v1/timesheets?limit=50&from=0&to=49&dateFrom=2026-08-01',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );

    // Page 2: from 50, to 99
    await client.listTimesheets('access-token', { from: 50, to: 99, limit: 50 });
    expect(fetcher).toHaveBeenCalledWith(
      'https://timesheet.example/api/v1/timesheets?limit=50&from=50&to=99',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );
  });

  it('posts batch delete payload to /api/v1/timesheets/batch-delete in a single request', async () => {
    const fetcher = jest.fn().mockImplementation(() =>
      Promise.resolve(response(200, {
        data: {
          results: [{ id: 't1', success: true }, { id: 't2', success: true }],
          deletedCount: 2,
        },
        error: null,
      }))
    );
    const client = new ApiClient('https://timesheet.example', fetcher);

    const res = await client.deleteTimesheets('access-token', ['t1', 't2']);
    expect(res.deletedCount).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://timesheet.example/api/v1/timesheets/batch-delete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['t1', 't2'] }),
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );
  });

  it('falls back to sequential deleteTimesheet when batch-delete returns 404', async () => {
    let callCount = 0;
    const fetcher = jest.fn().mockImplementation((url: string) => {
      callCount++;
      if (url.includes('batch-delete')) {
        return Promise.resolve(response(404, { data: null, error: { code: 'NOT_FOUND', message: 'Not found' } }));
      }
      return Promise.resolve(response(200, { data: { success: true }, error: null }));
    });
    const client = new ApiClient('https://timesheet.example', fetcher);

    const res = await client.deleteTimesheets('access-token', ['t1', 't2']);
    expect(res.deletedCount).toBe(2);
    expect(callCount).toBe(3); // 1 batch attempt + 2 sequential deletes
  });

  it('posts batch duplicate payload to /api/v1/timesheets/batch-duplicate in a single request', async () => {
    const fakeEntry = {
      id: 'dup-1',
      user_id: 'u-1',
      project_id: 'p-1',
      activity_type_id: null,
      hours_worked: 4,
      work_done: 'Work',
      log_date: '2026-08-30',
    };
    const fetcher = jest.fn().mockImplementation(() =>
      Promise.resolve(response(200, {
        data: {
          results: [{ id: 't1', success: true, entry: fakeEntry }],
          duplicatedCount: 1,
        },
        error: null,
      }))
    );
    const client = new ApiClient('https://timesheet.example', fetcher);

    const res = await client.duplicateTimesheets('access-token', [{ id: 't1' }]);
    expect(res.duplicatedCount).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://timesheet.example/api/v1/timesheets/batch-duplicate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ items: [{ id: 't1' }] }),
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );
  });

  it('falls back to sequential duplicateTimesheet when batch-duplicate returns 404', async () => {
    const fakeEntry = {
      id: 'dup-1',
      user_id: 'u-1',
      project_id: 'p-1',
      activity_type_id: null,
      hours_worked: 4,
      work_done: 'Work',
      log_date: '2026-08-30',
    };
    let callCount = 0;
    const fetcher = jest.fn().mockImplementation((url: string) => {
      callCount++;
      if (url.includes('batch-duplicate')) {
        return Promise.resolve(response(404, { data: null, error: { code: 'NOT_FOUND', message: 'Not found' } }));
      }
      return Promise.resolve(response(201, { data: { success: true, entry: fakeEntry }, error: null }));
    });
    const client = new ApiClient('https://timesheet.example', fetcher);

    const res = await client.duplicateTimesheets('access-token', [{ id: 't1' }, { id: 't2' }]);
    expect(res.duplicatedCount).toBe(2);
    expect(callCount).toBe(3); // 1 batch attempt + 2 sequential duplicate calls
  });
});
