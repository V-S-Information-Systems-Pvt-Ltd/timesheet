import { OfflineQueue } from '../src/storage/offline-queue';

describe('OfflineQueue', () => {
  it('enqueues, lists, dequeues, and records retries scoped by workspace and actor', async () => {
    const queue = new OfflineQueue();
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
});
