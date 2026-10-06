import { OfflineQueue } from '../src/storage/offline-queue';
import { SyncEngine } from '../src/sync/sync-engine';
import { MemoryKvStore } from '../src/platform/kv-store';
import { ApiClient, ApiClientError } from '../src/api/client';
import type { QueuedOfflineMutation } from '../src/storage/offline-queue';

const serverUrl = 'https://timesheet.example.com';
const actorId = 'actor-v2';

const leaveInput = { userId: undefined, leaveDate: '2026-09-28', reason: 'Family day' };

/** Seeds a non-legacy leave create in manual_review (commit-unknown). */
async function seedUncertainLeave(store: MemoryKvStore): Promise<QueuedOfflineMutation> {
  const item: QueuedOfflineMutation = {
    id: 'mut_leave_1',
    type: 'create_leave',
    payload: { input: leaveInput },
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    origin: serverUrl,
    retryCount: 0,
    status: 'manual_review',
    lastError: 'already completed — refresh and review',
    commitState: 'uncertain',
  };
  await store.setItem(
    `vsis_offline_queue_${serverUrl}_${actorId}`,
    JSON.stringify({ version: 2, items: [item], tickets: {} })
  );
  return item;
}

describe('manual-review resolution by keyed replay', () => {
  it.each(['create_leave', 'update_timesheet'] as const)(
    'retains %s unchanged without sending when creation time is expired or malformed', async type => {
      for (const createdAt of [
        new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        'invalid-time',
      ]) {
        const store = new MemoryKvStore();
        const item = await seedUncertainLeave(store);
        const key = `vsis_offline_queue_${serverUrl}_${actorId}`;
        const original = JSON.stringify({ version: 2, tickets: {}, items: [{ ...item, type, createdAt,
          ...(type === 'update_timesheet' ? { payload: { id: 't1', input: { hoursWorked: 2 } } } : {}),
        }] });
        await store.setItem(key, original);
        const createLeave = jest.fn();
        const updateTimesheet = jest.fn();
        const engine = new SyncEngine(new OfflineQueue(store));
        await expect(engine.resolveMutation({ createLeave, updateTimesheet } as unknown as ApiClient,
          serverUrl, actorId, 'token', item.id)).rejects.toThrow('90-day replay window');
        expect(createLeave).not.toHaveBeenCalled();
        expect(updateTimesheet).not.toHaveBeenCalled();
        expect(await store.getItem(key)).toBe(original);
      }
    }
  );

  it('preserves a terminal 401 error and retains the uncertain queue item', async () => {
    const store = new MemoryKvStore();
    await seedUncertainLeave(store);
    const queue = new OfflineQueue(store);
    const expired = new ApiClientError(401, { data: null, error: { code: 'UNAUTHORIZED', message: 'Session revoked' } });
    const engine = new SyncEngine(queue);
    await expect(engine.resolveMutation({ createLeave: jest.fn().mockRejectedValue(expired) } as unknown as ApiClient,
      serverUrl, actorId, 'token', 'mut_leave_1')).rejects.toBe(expired);
    expect(await queue.list(serverUrl, actorId)).toMatchObject([{ id: 'mut_leave_1', status: 'manual_review', commitState: 'uncertain' }]);
  });

  it('resolves a non-legacy commit-unknown leave by replaying the same key, dequeuing on success', async () => {
    const store = new MemoryKvStore();
    await seedUncertainLeave(store);
    const queue = new OfflineQueue(store);
    const engine = new SyncEngine(queue);

    const createLeave = jest.fn().mockResolvedValue({ success: true });
    const client = { createLeave } as unknown as ApiClient;

    await engine.resolveMutation(client, serverUrl, actorId, 'token', 'mut_leave_1');

    expect(createLeave).toHaveBeenCalledTimes(1);
    expect(createLeave.mock.calls[0][2]).toEqual({ idempotencyKey: 'mut_leave_1' });
    expect(await queue.size(serverUrl, actorId)).toBe(0);
  });

  it('keeps the item in manual_review when the server still reports commit-unknown', async () => {
    const store = new MemoryKvStore();
    await seedUncertainLeave(store);
    const queue = new OfflineQueue(store);
    const engine = new SyncEngine(queue);

    const commitUnknown = new ApiClientError(409, {
      data: null,
      error: { code: 'IDEMPOTENCY_COMMIT_UNKNOWN', message: 'Do not re-run this mutation.' },
    });
    const createLeave = jest.fn().mockRejectedValue(commitUnknown);
    const client = { createLeave } as unknown as ApiClient;

    await expect(
      engine.resolveMutation(client, serverUrl, actorId, 'token', 'mut_leave_1')
    ).rejects.toBe(commitUnknown);

    const [item] = await queue.list(serverUrl, actorId);
    expect(item).toMatchObject({ id: 'mut_leave_1', status: 'manual_review', commitState: 'uncertain' });
  });

  it('refuses to resolve an item not in manual_review', async () => {
    const store = new MemoryKvStore();
    const queue = new OfflineQueue(store);
    const item: QueuedOfflineMutation = {
      id: 'mut_leave_2',
      type: 'create_leave',
      payload: { input: leaveInput },
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      origin: serverUrl,
      retryCount: 0,
      status: 'queued',
    };
    await store.setItem(
      `vsis_offline_queue_${serverUrl}_${actorId}`,
      JSON.stringify({ version: 2, items: [item], tickets: {} })
    );
    const engine = new SyncEngine(queue);
    const client = { createLeave: jest.fn() } as unknown as ApiClient;

    await expect(
      engine.resolveMutation(client, serverUrl, actorId, 'token', 'mut_leave_2')
    ).rejects.toThrow('Only failed items in manual review');
    expect(client.createLeave).not.toHaveBeenCalled();
  });
});
