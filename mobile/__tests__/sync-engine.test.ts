import { SyncEngine } from '../src/sync/sync-engine';
import { OfflineQueue } from '../src/storage/offline-queue';
import { TelemetryService } from '../src/telemetry/telemetry';
import { ApiClient, ApiClientError } from '../src/api/client';

describe('SyncEngine', () => {
  const serverUrl = 'https://timesheet.example.com';
  const actorId = 'actor-1';
  const accessToken = 'token-123';

  it('successfully flushes queued mutations and dequeues them', async () => {
    const queue = new OfflineQueue();
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
      input: {
        projectId: 'p1',
        activityTypeId: 'a1',
        hoursWorked: 4,
        workDone: 'Feature impl',
        logDate: '2026-08-28',
      },
    });

    await queue.enqueue(serverUrl, actorId, 'delete_timesheet', {
      id: 't-1',
    });

    const mockCreate = jest.fn().mockResolvedValue(undefined);
    const mockDelete = jest.fn().mockResolvedValue(undefined);

    const client = {
      createTimesheet: mockCreate,
      deleteTimesheet: mockDelete,
    } as unknown as ApiClient;

    const result = await engine.flush(client, serverUrl, actorId, accessToken);

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockCreate).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith(accessToken, 't-1');
    expect(await queue.size(serverUrl, actorId)).toBe(0);
  });

  it('stops execution on network error to preserve sequential ordering', async () => {
    const queue = new OfflineQueue();
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
      input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Task 1', logDate: '2026-08-28' },
    });
    await queue.enqueue(serverUrl, actorId, 'delete_timesheet', {
      id: 't-2',
    });

    const mockCreate = jest.fn().mockRejectedValue(new Error('Network error: Offline'));
    const mockDelete = jest.fn().mockResolvedValue(undefined);

    const client = {
      createTimesheet: mockCreate,
      deleteTimesheet: mockDelete,
    } as unknown as ApiClient;

    const result = await engine.flush(client, serverUrl, actorId, accessToken);

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(await queue.size(serverUrl, actorId)).toBe(2);
  });

  it('discards item with 400 validation error to prevent infinite queue blocking', async () => {
    const queue = new OfflineQueue();
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
      input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Task 1', logDate: '2026-08-28' },
    });
    await queue.enqueue(serverUrl, actorId, 'delete_timesheet', {
      id: 't-2',
    });

    const mockCreate = jest.fn().mockRejectedValue(
      new ApiClientError(400, { data: null, error: { message: 'Invalid project ID' } })
    );
    const mockDelete = jest.fn().mockResolvedValue(undefined);

    const client = {
      createTimesheet: mockCreate,
      deleteTimesheet: mockDelete,
    } as unknown as ApiClient;

    const result = await engine.flush(client, serverUrl, actorId, accessToken);

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(mockDelete).toHaveBeenCalledWith(accessToken, 't-2');
    expect(await queue.size(serverUrl, actorId)).toBe(0);
  });
});
