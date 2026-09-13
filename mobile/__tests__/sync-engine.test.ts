import { SyncEngine, OFFLINE_REPLAY_MAX_AGE_DAYS } from '../src/sync/sync-engine';
import { OfflineQueue } from '../src/storage/offline-queue';
import { MemoryKvStore } from '../src/platform/kv-store';
import { TelemetryService } from '../src/telemetry/telemetry';
import { ApiClient, ApiClientError } from '../src/api/client';

describe('SyncEngine', () => {
  const serverUrl = 'https://timesheet.example.com';
  const actorId = 'actor-1';
  const accessToken = 'token-123';

  it('successfully flushes queued mutations and dequeues them', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
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

    const result = await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockCreate).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith(accessToken, 't-1', expect.objectContaining({ idempotencyKey: expect.any(String) }));
    expect(await queue.size(serverUrl, actorId)).toBe(0);
  });

  it('stops execution on network error to preserve sequential ordering', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
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

    const result = await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(await queue.size(serverUrl, actorId)).toBe(2);
  });

  it('retains mutation in failed state on 400 validation error without discarding user work', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
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

    const result = await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(mockDelete).toHaveBeenCalledWith(accessToken, 't-2', expect.objectContaining({ idempotencyKey: expect.any(String) }));
    // 400 mutation is retained in failed state; valid delete mutation was dequeued
    expect(await queue.size(serverUrl, actorId)).toBe(1);
    const remaining = await queue.list(serverUrl, actorId);
    expect(remaining[0].status).toBe('failed');
    expect(remaining[0].lastError).toBe('Invalid project ID');
  });

  it('transitions mutations older than 90 days to manual_review status', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    const oldItem = await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
      input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Old Task', logDate: '2026-05-01' },
    });

    const storageKey = `vsis_offline_queue_${serverUrl}_${actorId}`;
    const store = (queue as unknown as { store: { setItem: (k: string, v: string) => Promise<void> } }).store;
    const oldDate = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();
    await store.setItem(storageKey, JSON.stringify([{ ...oldItem, createdAt: oldDate }]));
    (queue as unknown as { inMemory: Map<string, unknown> }).inMemory.clear();

    const client = { createTimesheet: jest.fn() } as unknown as ApiClient;
    const result = await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    expect(client.createTimesheet).not.toHaveBeenCalled();

    const items = await queue.list(serverUrl, actorId);
    expect(items[0].status).toBe('manual_review');
  });

  it('transitions a mutation exactly at the 90-day boundary to manual_review (inclusive)', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    // Freeze Date.now so the age comparison is exact (no wall-clock drift
    // between constructing createdAt and running flush).
    const now = Date.UTC(2026, 8, 9, 12, 0, 0);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const item = await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
        input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Exact boundary', logDate: '2026-06-11' },
      });

      const storageKey = `vsis_offline_queue_${serverUrl}_${actorId}`;
      const store = (queue as unknown as { store: { setItem: (k: string, v: string) => Promise<void> } }).store;
      const boundaryMs = OFFLINE_REPLAY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      const exactly90DaysOld = new Date(now - boundaryMs).toISOString();
      await store.setItem(storageKey, JSON.stringify([{ ...item, createdAt: exactly90DaysOld }]));
      (queue as unknown as { inMemory: Map<string, unknown> }).inMemory.clear();

      const mockCreate = jest.fn();
      const client = { createTimesheet: mockCreate } as unknown as ApiClient;
      const result = await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

      // The boundary is inclusive: a mutation exactly 90 days old is reviewed,
      // never auto-replayed.
      expect(result.processed).toBe(0);
      expect(result.failed).toBe(1);
      expect(mockCreate).not.toHaveBeenCalled();
      const items = await queue.list(serverUrl, actorId);
      expect(items[0].status).toBe('manual_review');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('still replays a mutation just under the 90-day boundary', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    const now = Date.UTC(2026, 8, 9, 12, 0, 0);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const item = await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
        input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Under boundary', logDate: '2026-06-11' },
      });

      const storageKey = `vsis_offline_queue_${serverUrl}_${actorId}`;
      const store = (queue as unknown as { store: { setItem: (k: string, v: string) => Promise<void> } }).store;
      const boundaryMs = OFFLINE_REPLAY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      // One minute short of the boundary: must auto-replay, not go to review.
      const justUnder = new Date(now - (boundaryMs - 60_000)).toISOString();
      await store.setItem(storageKey, JSON.stringify([{ ...item, createdAt: justUnder }]));
      (queue as unknown as { inMemory: Map<string, unknown> }).inMemory.clear();

      const mockCreate = jest.fn().mockResolvedValue(undefined);
      const client = { createTimesheet: mockCreate } as unknown as ApiClient;
      const result = await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(await queue.size(serverUrl, actorId)).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('pauses and retains mutations on 401 authentication error without deleting them', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
      input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Task 1', logDate: '2026-08-28' },
    });

    const mockCreate = jest.fn().mockRejectedValue(
      new ApiClientError(401, { data: null, error: { message: 'Token expired' } })
    );

    const client = { createTimesheet: mockCreate } as unknown as ApiClient;
    const result = await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(await queue.size(serverUrl, actorId)).toBe(1); // retained!
  });

  it.each([
    { status: 403, message: 'Forbidden' },
    { status: 503, message: 'Mobile API disabled' },
  ])('pauses and retains mutations on $status without deleting them', async ({ status, message }) => {
    const queue = new OfflineQueue(new MemoryKvStore());
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
      input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Task 1', logDate: '2026-08-28' },
    });

    const mockCreate = jest.fn().mockRejectedValue(
      new ApiClientError(status, { data: null, error: { message } })
    );

    const client = { createTimesheet: mockCreate } as unknown as ApiClient;
    const result = await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(await queue.size(serverUrl, actorId)).toBe(1); // retained!

    const items = await queue.list(serverUrl, actorId);
    expect(items[0].status).toBe('queued');
    expect(items[0].retryCount).toBe(1);
  });

  it('propagates mutation id as idempotencyKey to createTimesheet', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    const enqueued = await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
      input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 8, workDone: 'Full day', logDate: '2026-08-28' },
    });

    const mockCreate = jest.fn().mockResolvedValue({ success: true });
    const client = { createTimesheet: mockCreate } as unknown as ApiClient;

    await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

    expect(mockCreate).toHaveBeenCalledWith(
      accessToken,
      expect.objectContaining({ projectId: 'p1' }),
      { idempotencyKey: enqueued.id }
    );
  });

  it('treats 409 IDEMPOTENCY_IN_FLIGHT as transient retryable and pauses sync', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
      input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'In flight test', logDate: '2026-08-28' },
    });

    const mockCreate = jest.fn().mockRejectedValue(
      new ApiClientError(409, {
        data: null,
        error: { code: 'IDEMPOTENCY_IN_FLIGHT', message: 'Mutation currently in flight.' },
      })
    );

    const client = { createTimesheet: mockCreate } as unknown as ApiClient;
    const result = await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(await queue.size(serverUrl, actorId)).toBe(1);

    const items = await queue.list(serverUrl, actorId);
    expect(items[0].status).toBe('queued');
    expect(items[0].retryCount).toBe(1);
    expect(items[0].lastError).toContain('in flight');
  });

  it('maps IDEMPOTENCY_COMMIT_UNKNOWN to manual_review with already completed message', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
      input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Commit unknown test', logDate: '2026-08-28' },
    });

    const mockCreate = jest.fn().mockRejectedValue(
      new ApiClientError(409, {
        data: null,
        error: {
          code: 'IDEMPOTENCY_COMMIT_UNKNOWN',
          message: 'The operation already completed but its outcome could not be recorded. Do not re-run this mutation.',
        },
      })
    );

    const client = { createTimesheet: mockCreate } as unknown as ApiClient;
    const result = await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);

    const items = await queue.list(serverUrl, actorId);
    expect(items[0].status).toBe('manual_review');
    expect(items[0].lastError).toContain('already completed — refresh and review');
  });

  it('caps retries at MAX_AUTO_RETRIES and transitions to manual_review', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    const item = await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
      input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Retry cap test', logDate: '2026-08-28' },
    });

    // Simulate already having 9 retries (next failure is 10th attempt)
    const storageKey = `vsis_offline_queue_${serverUrl}_${actorId}`;
    const store = (queue as unknown as { store: { setItem: (k: string, v: string) => Promise<void> } }).store;
    await store.setItem(storageKey, JSON.stringify([{ ...item, retryCount: 9 }]));
    (queue as unknown as { inMemory: Map<string, unknown> }).inMemory.clear();

    const mockCreate = jest.fn().mockRejectedValue(new Error('Network error: server unreachable'));
    const client = { createTimesheet: mockCreate } as unknown as ApiClient;

    const result = await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);

    const items = await queue.list(serverUrl, actorId);
    expect(items[0].status).toBe('manual_review');
    expect(items[0].lastError).toContain('Exceeded maximum retries (10)');
  });

  it('retains queued mutations and does not replay when server lacks durable idempotency', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
      input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Gate test', logDate: '2026-08-28' },
    });

    const mockCreate = jest.fn();
    const client = { createTimesheet: mockCreate } as unknown as ApiClient;

    // capability absent/undefined -> treated as false
    const result = await engine.flush(client, serverUrl, actorId, accessToken);

    expect(result.processed).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(await queue.size(serverUrl, actorId)).toBe(1);
  });

  it('replays after a retry once the server advertises durable idempotency', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    const tel = new TelemetryService();
    const engine = new SyncEngine(queue, tel);

    await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
      input: { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Gate on test', logDate: '2026-08-28' },
    });

    const mockCreate = jest.fn().mockResolvedValue(undefined);
    const client = { createTimesheet: mockCreate } as unknown as ApiClient;

    const result = await engine.flush(client, serverUrl, actorId, accessToken, { durableIdempotency: true });

    expect(result.succeeded).toBe(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(await queue.size(serverUrl, actorId)).toBe(0);
  });
});
