import { OfflineQueue, MAX_OFFLINE_QUEUE_ITEMS } from '../src/storage/offline-queue';
import {
  MemoryKvStore,
  NativeKvStore,
  KvStoreError,
  type NativeKvStorageModule,
} from '../src/platform/kv-store';

describe('OfflineQueue & NativeKvStore', () => {
  describe('OfflineQueue core operations', () => {
    it('enqueues, lists, dequeues, and records retries scoped by workspace and actor', async () => {
      const store = new MemoryKvStore();
      const queue = new OfflineQueue(store);
      const serverUrl = 'https://timesheet.example.com';
      const actorId = 'actor-123';

      expect(await queue.size(serverUrl, actorId)).toBe(0);

      const m1 = await queue.enqueue(serverUrl, actorId, 'create_timesheet', {
        input: {
          projectId: 'p1',
          activityTypeId: 'a1',
          hoursWorked: 4,
          workDone: 'Investigating issue',
          logDate: '2026-08-28',
        },
      });

      const m2 = await queue.enqueue(serverUrl, actorId, 'delete_timesheet', {
        id: 't-99',
      });

      expect(await queue.size(serverUrl, actorId)).toBe(2);

      const items = await queue.list(serverUrl, actorId);
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe(m1.id);
      expect(items[1].id).toBe(m2.id);

      // Record retry on m1
      await queue.recordRetry(serverUrl, actorId, m1.id, 'Connection timeout');
      const updatedItems = await queue.list(serverUrl, actorId);
      expect(updatedItems[0].retryCount).toBe(1);
      expect(updatedItems[0].lastError).toBe('Connection timeout');

      // Dequeue m1
      await queue.dequeue(serverUrl, actorId, m1.id);
      expect(await queue.size(serverUrl, actorId)).toBe(1);

      // Other workspace/actor is isolated
      expect(await queue.size('https://other.example.com', actorId)).toBe(0);
      expect(await queue.size(serverUrl, 'other-actor')).toBe(0);

      // Clear
      await queue.clear(serverUrl, actorId);
      expect(await queue.size(serverUrl, actorId)).toBe(0);
    });

    it('survives simulated process death and re-reads persisted items truthful to storage', async () => {
      const sharedStore = new MemoryKvStore();
      const instance1 = new OfflineQueue(sharedStore);
      const serverUrl = 'https://timesheet.example.com';
      const actorId = 'actor-death-test';

      const mutation = await instance1.enqueue(serverUrl, actorId, 'create_timesheet', {
        input: {
          projectId: 'proj-survive',
          activityTypeId: 'act-survive',
          hoursWorked: 7.5,
          workDone: 'Crash recovery verification',
          logDate: '2026-09-06',
        },
      });

      // Simulate process restart: new instance reading from same underlying store
      const instance2 = new OfflineQueue(sharedStore);
      const recovered = await instance2.list(serverUrl, actorId);
      expect(recovered).toHaveLength(1);
      expect(recovered[0].id).toBe(mutation.id);
      expect(recovered[0].payload).toEqual(mutation.payload);
      expect(recovered[0].createdAt).toBe(mutation.createdAt);
    });

    it('propagates durable storage write errors to callers and does not update in-memory state', async () => {
      const failingStore = {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockRejectedValue(new KvStoreError('write-failed', 'Disk full')),
        removeItem: jest.fn().mockResolvedValue(undefined),
      };

      const queue = new OfflineQueue(failingStore);
      const serverUrl = 'https://timesheet.example.com';
      const actorId = 'actor-err';

      await expect(
        queue.enqueue(serverUrl, actorId, 'delete_timesheet', { id: 't-fail' })
      ).rejects.toThrow('Disk full');

      // In-memory items must not include the failed item
      expect(await queue.size(serverUrl, actorId)).toBe(0);
    });

    it('rejects corrupt stored queue data with KvStoreError corrupt code', async () => {
      const corruptStore = {
        getItem: jest.fn().mockResolvedValue('not-valid-json{{{'),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
      };

      const queue = new OfflineQueue(corruptStore);
      await expect(queue.list('https://timesheet.example.com', 'actor-corrupt')).rejects.toMatchObject({
        code: 'corrupt',
      });
    });

    it('serializes concurrent enqueues on the same workspace/actor', async () => {
      const store = new MemoryKvStore();
      const queue = new OfflineQueue(store);
      const serverUrl = 'https://timesheet.example.com';
      const actorId = 'actor-race';

      // Launch 5 simultaneous enqueues
      const promises = Array.from({ length: 5 }, (_, i) =>
        queue.enqueue(serverUrl, actorId, 'delete_timesheet', { id: `t-${i}` })
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
      expect(await queue.size(serverUrl, actorId)).toBe(5);

      const items = await queue.list(serverUrl, actorId);
      expect(items).toHaveLength(5);
      // Verify all IDs are distinct and preserved
      const ids = items.map((m) => (m.payload as { id: string }).id);
      expect(new Set(ids).size).toBe(5);
    });

    it('enforces capacity limit and rejects when queue reaches MAX_OFFLINE_QUEUE_ITEMS', async () => {
      const store = new MemoryKvStore();
      const queue = new OfflineQueue(store);
      const serverUrl = 'https://timesheet.example.com';
      const actorId = 'actor-cap';

      for (let i = 0; i < MAX_OFFLINE_QUEUE_ITEMS; i++) {
        await queue.enqueue(serverUrl, actorId, 'delete_timesheet', { id: `t-${i}` });
      }
      expect(await queue.size(serverUrl, actorId)).toBe(MAX_OFFLINE_QUEUE_ITEMS);

      await expect(
        queue.enqueue(serverUrl, actorId, 'delete_timesheet', { id: 't-overflow' })
      ).rejects.toMatchObject({
        code: 'capacity',
      });
    });
  });

  describe('NativeKvStore adapter', () => {
    it('validates keys and rejects empty or blank keys', async () => {
      const adapter = new NativeKvStore({
        readItem: jest.fn(),
        writeItem: jest.fn(),
        removeItem: jest.fn(),
      });

      await expect(adapter.getItem('')).rejects.toMatchObject({ code: 'invalid-key' });
      await expect(adapter.getItem('   ')).rejects.toMatchObject({ code: 'invalid-key' });
      await expect(adapter.setItem('', 'value')).rejects.toMatchObject({ code: 'invalid-key' });
      await expect(adapter.removeItem('')).rejects.toMatchObject({ code: 'invalid-key' });
    });

    it('normalizes Windows PasswordVault empty-string absence to null', async () => {
      const mockModule: NativeKvStorageModule = {
        readItem: jest.fn().mockResolvedValue(''), // Windows resolves "" on not-found
        writeItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
      };

      const adapter = new NativeKvStore(mockModule);
      expect(await adapter.getItem('missing-key')).toBeNull();
    });

    it('maps native errors to KvStoreError codes', async () => {
      const lockedModule: NativeKvStorageModule = {
        readItem: jest.fn().mockRejectedValue({ code: 'locked', message: 'Vault locked' }),
        writeItem: jest.fn().mockRejectedValue('WRITE-FAILED'),
        removeItem: jest.fn().mockRejectedValue(new Error('Unknown native error')),
      };

      const adapter = new NativeKvStore(lockedModule);
      await expect(adapter.getItem('key')).rejects.toMatchObject({ code: 'locked' });
      await expect(adapter.setItem('key', 'val')).rejects.toMatchObject({ code: 'write-failed' });
      await expect(adapter.removeItem('key')).rejects.toMatchObject({ code: 'delete-failed' });
    });

    it('fails closed when native module is unavailable', async () => {
      const adapter = new NativeKvStore();
      await expect(adapter.getItem('test-key')).rejects.toMatchObject({ code: 'unavailable' });
    });
  });
});
