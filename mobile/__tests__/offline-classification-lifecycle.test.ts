import { OfflineQueue } from '../src/storage/offline-queue';
import { SyncEngine } from '../src/sync/sync-engine';
import { MemoryKvStore } from '../src/platform/kv-store';
import { ApiClient, ApiClientError } from '../src/api/client';
import type { QueuedOfflineMutation } from '../src/storage/offline-queue';

const serverUrl = 'https://timesheet.example.com';
const actorId = 'actor-v2';

const legacyInput = {
  projectId: 'p1',
  activityTypeId: 'a1',
  hoursWorked: 4,
  workDone: 'Queued before classification',
  logDate: '2026-09-28',
};

const v2Input = {
  entryType: 'support' as const,
  activityCode: 'customers' as const,
  projectId: null,
  activityTypeId: null,
  ticketNumber: 'T-0042',
  activityOther: null,
  hoursWorked: 2,
  workDone: 'Reclassified support call',
  logDate: '2026-09-28',
};

/** Seeds a legacy payload with explicit or pre-upgrade unknown delivery state. */
async function seedLegacyQueue(store: MemoryKvStore, options: Pick<QueuedOfflineMutation, 'commitState'> = { commitState: 'unattempted' }): Promise<void> {
  const item: QueuedOfflineMutation = {
    id: 'mut_legacy_1',
    type: 'create_timesheet',
    payload: { input: legacyInput },
    createdAt: '2026-09-28T08:00:00.000Z',
    origin: serverUrl,
    retryCount: 0,
    status: 'queued',
    commitState: options.commitState,
  };
  await store.setItem(
    `vsis_offline_queue_${serverUrl}_${actorId}`,
    JSON.stringify({ version: 2, items: [item], tickets: {} })
  );
}

describe('classification offline lifecycle', () => {
  it('moves legacy cached creates to manual_review on read without mutating the stored row key', async () => {
    const store = new MemoryKvStore();
    await seedLegacyQueue(store);
    const queue = new OfflineQueue(store);

    const items = await queue.list(serverUrl, actorId);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('mut_legacy_1');
    expect(items[0].status).toBe('manual_review');
    expect(items[0].payload).toEqual({ input: legacyInput });
  });

  it('blocks replacement while the original commit is uncertain, including across restart', async () => {
    const store = new MemoryKvStore();
    await seedLegacyQueue(store);
    const queue = new OfflineQueue(store);
    await queue.list(serverUrl, actorId);
    // Simulate a send that began but never resolved its outcome.
    await queue.markFailed(serverUrl, actorId, 'mut_legacy_1', 'still loading', 'manual_review');

    // Force the uncertain state the send path would persist.
    await queue.execute(serverUrl, actorId, 'mut_legacy_1',
      () => new Promise<never>((_, reject) => reject(new TypeError('Network request failed'))),
      () => false,
      true
    ).catch(() => undefined);

    await expect(
      queue.replaceLegacyCreate(serverUrl, actorId, 'mut_legacy_1', v2Input)
    ).rejects.toThrow('commit is uncertain');

    // Restart: a fresh queue over the same storage still refuses replacement.
    const restarted = new OfflineQueue(store);
    const [item] = await restarted.list(serverUrl, actorId);
    expect(item.commitState).toBe('uncertain');
    await expect(
      restarted.replaceLegacyCreate(serverUrl, actorId, 'mut_legacy_1', v2Input)
    ).rejects.toThrow('commit is uncertain');
  });

  it('recovers an uncertain legacy create by replaying the same key before review', async () => {
    const store = new MemoryKvStore();
    await seedLegacyQueue(store);
    const queue = new OfflineQueue(store);
    await queue.list(serverUrl, actorId);
    await queue.execute(serverUrl, actorId, 'mut_legacy_1',
      () => new Promise<never>((_, reject) => reject(new TypeError('Network request failed'))),
      () => false,
      true
    ).catch(() => undefined);

    const createTimesheet = jest.fn().mockResolvedValue({ success: true });
    const client = { createTimesheet } as unknown as ApiClient;
    const engine = new SyncEngine(queue);

    const draft = await engine.reviewLegacyCreate(client, serverUrl, actorId, 'token', 'mut_legacy_1');
    expect(draft).toBeNull();
    expect(createTimesheet).toHaveBeenCalledTimes(1);
    expect(createTimesheet.mock.calls[0][2]).toEqual({ idempotencyKey: 'mut_legacy_1' });
    expect(await queue.size(serverUrl, actorId)).toBe(0);
  });

  it.each(['CLASSIFICATION_REQUIRED', 'CLIENT_UPDATE_REQUIRED'])('keeps uncertain or pre-upgrade requests blocked after %s, including restart', async code => {
    for (const commitState of ['uncertain', undefined] as const) {
      const store = new MemoryKvStore();
      await seedLegacyQueue(store, { commitState });
      const queue = new OfflineQueue(store);
      const rejection = new ApiClientError(409, { data: null, error: { code, message: 'Classification compatibility rejection' } });
      const createTimesheet = jest.fn().mockRejectedValue(rejection);
      const client = { createTimesheet } as unknown as ApiClient;
      const engine = new SyncEngine(queue);

      await expect(engine.reviewLegacyCreate(client, serverUrl, actorId, 'token', 'mut_legacy_1')).rejects.toThrow('commit is uncertain');
      expect(createTimesheet.mock.calls[0][1]).toEqual(legacyInput);
      expect(createTimesheet.mock.calls[0][2]).toEqual({ idempotencyKey: 'mut_legacy_1' });
      const [item] = await queue.list(serverUrl, actorId);
      expect(item).toMatchObject({ id: 'mut_legacy_1', status: 'manual_review', commitState: 'uncertain', payload: { input: legacyInput } });
      await expect(queue.replaceLegacyCreate(serverUrl, actorId, item.id, v2Input)).rejects.toThrow('commit is uncertain');

      const restarted = new OfflineQueue(store);
      await expect(new SyncEngine(restarted).reviewLegacyCreate(client, serverUrl, actorId, 'token', item.id)).rejects.toThrow('commit is uncertain');
      await expect(restarted.replaceLegacyCreate(serverUrl, actorId, item.id, v2Input)).rejects.toThrow('commit is uncertain');
      expect(await restarted.list(serverUrl, actorId)).toEqual([item]);
    }
  });

  it.each(['CLASSIFICATION_REQUIRED', 'CLIENT_UPDATE_REQUIRED'])('allows review and fresh-key replacement of a first-attempt %s rejection', async code => {
    const store = new MemoryKvStore();
    await seedLegacyQueue(store);
    const queue = new OfflineQueue(store);
    const rejection = new ApiClientError(409, { data: null, error: { code, message: 'Classification compatibility rejection' } });
    await expect(queue.execute(serverUrl, actorId, 'mut_legacy_1', async () => { throw rejection; }, () => true, true)).rejects.toBe(rejection);
    const restarted = new OfflineQueue(store);
    const [item] = await restarted.list(serverUrl, actorId);
    expect(item.commitState).toBe('rejected');
    const createTimesheet = jest.fn();
    const draft = await new SyncEngine(restarted).reviewLegacyCreate({ createTimesheet } as unknown as ApiClient, serverUrl, actorId, 'token', item.id);
    expect(draft).toMatchObject({ entryType: null, activityCode: null, projectId: 'p1', hoursWorked: 4, workDone: 'Queued before classification' });
    expect(createTimesheet).not.toHaveBeenCalled();
    const replacement = await restarted.replaceLegacyCreate(serverUrl, actorId, item.id, v2Input);
    expect(replacement.id).not.toBe(item.id);
    expect(replacement.commitState).toBe('unattempted');
    expect(await restarted.list(serverUrl, actorId)).toEqual([replacement]);
  });

  it('atomically replaces with a fresh key only after recovery, validating the payload', async () => {
    const store = new MemoryKvStore();
    await seedLegacyQueue(store);
    const queue = new OfflineQueue(store);
    await queue.list(serverUrl, actorId);

    const invalid = await queue.replaceLegacyCreate(serverUrl, actorId, 'mut_legacy_1', {
      ...v2Input,
      ticketNumber: '',
    }).catch((e: Error) => e);
    expect(invalid).toBeInstanceOf(Error);

    const replaced = await queue.replaceLegacyCreate(serverUrl, actorId, 'mut_legacy_1', v2Input);
    expect(replaced.id).not.toBe('mut_legacy_1');
    expect(replaced.status).toBe('queued');
    const items = await queue.list(serverUrl, actorId);
    expect(items).toHaveLength(1);
    expect(items[0].payload).toEqual({ input: v2Input });
  });

  it('serializes concurrent replacement attempts without duplicating the draft', async () => {
    const store = new MemoryKvStore();
    await seedLegacyQueue(store);
    const queue = new OfflineQueue(store);
    await queue.list(serverUrl, actorId);

    const [first, second] = await Promise.allSettled([
      queue.replaceLegacyCreate(serverUrl, actorId, 'mut_legacy_1', v2Input),
      queue.replaceLegacyCreate(serverUrl, actorId, 'mut_legacy_1', v2Input),
    ]);

    // The queue lock serializes replacements: exactly one wins, the loser sees
    // the draft already retired, and only one live item remains under one key.
    const outcomes = [first.status, second.status].sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);
    const items = await queue.list(serverUrl, actorId);
    expect(items).toHaveLength(1);
    expect(new Set(items.map((i) => i.id)).size).toBe(1);
    expect(items[0].payload).toEqual({ input: v2Input });
  });

  it('skips legacy creates during flush; valid replacements sync with their fresh key', async () => {
    const store = new MemoryKvStore();
    await seedLegacyQueue(store);
    const queue = new OfflineQueue(store);
    await queue.list(serverUrl, actorId);
    const replaced = await queue.replaceLegacyCreate(serverUrl, actorId, 'mut_legacy_1', v2Input);

    const createTimesheet = jest.fn().mockResolvedValue({ success: true });
    const client = { createTimesheet } as unknown as ApiClient;
    const engine = new SyncEngine(queue);
    const result = await engine.flush(client, serverUrl, actorId, 'token', { durableIdempotency: true });

    expect(result.succeeded).toBe(1);
    expect(createTimesheet).toHaveBeenCalledTimes(1);
    expect(createTimesheet.mock.calls[0][2]).toEqual({ idempotencyKey: replaced.id });
    expect(createTimesheet.mock.calls[0][1]).toMatchObject({ ticketNumber: 'T-0042' });
    expect(await queue.size(serverUrl, actorId)).toBe(0);
  });
});
