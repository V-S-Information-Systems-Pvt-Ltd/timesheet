import { ApiClientError, type ApiClient } from '../src/api/client';
import { createLeavesActions } from '../src/auth/domains/leaves';
import { createRemindersActions } from '../src/auth/domains/reminders';
import type { WithAuth } from '../src/auth/domains/types';
import { MemoryKvStore } from '../src/platform/kv-store';
import { OfflineQueue } from '../src/storage/offline-queue';

describe('ticketed fresh create actions', () => {
  const serverUrl = 'https://timesheet.example.com';
  const actorId = 'actor-wal';

  it('persists a reminder with its ticket before sending and retains it after a lost response', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    await queue.addTickets(serverUrl, actorId, 'create_reminder', [
      { key: 'mf_reminder_wal', expiresAt: new Date(Date.now() + 97 * 86400000).toISOString() },
    ]);
    const calls: string[] = [];
    const client = {
      createReminder: jest.fn(async (_token: string, _input: unknown, options: { idempotencyKey: string }) => {
        calls.push('request');
        const [pending] = await queue.list(serverUrl, actorId);
        expect(pending.idempotencyKey).toBe(options.idempotencyKey);
        throw new Error('Network error: Offline');
      }),
    } as unknown as ApiClient;
    const withAuth: WithAuth = async <T,>(fn: (client: ApiClient, token: string) => Promise<T>) =>
      fn(client, 'access-token');
    const actions = createRemindersActions(withAuth, {
      setGlobalReminders: (() => undefined) as never,
      loadGlobalReminders: async () => [],
      enqueueFreshCreate: async (input) => {
        calls.push('queued');
        return queue.enqueueWithTicket(serverUrl, actorId, 'create_reminder', { input });
      },
      completeFreshCreate: async (id) => queue.dequeue(serverUrl, actorId, id),
      markFreshCreateForReview: async (id, message) =>
        queue.markFailed(serverUrl, actorId, id, message, 'manual_review'),
    });

    await expect(
      actions.createReminder({ message: 'Call client', remindAt: '2026-10-01T09:00:00.000Z' })
    ).resolves.toBeUndefined();

    expect(calls).toEqual(['queued', 'request']);
    const [pending] = await queue.list(serverUrl, actorId);
    expect(pending.idempotencyKey).toBe('mf_reminder_wal');
    expect(client.createReminder).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ message: 'Call client' }),
      { idempotencyKey: 'mf_reminder_wal' }
    );
  });

  it('removes the write-ahead leave after confirmed success', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    await queue.addTickets(serverUrl, actorId, 'create_leave', [
      { key: 'mf_leave_wal', expiresAt: new Date(Date.now() + 97 * 86400000).toISOString() },
    ]);
    const client = {
      createLeave: jest.fn(async (_token: string, _input: unknown, _options: unknown) => {
        const [pending] = await queue.list(serverUrl, actorId);
        expect(pending.idempotencyKey).toBe('mf_leave_wal');
        return { success: true };
      }),
    } as unknown as ApiClient;
    const withAuth: WithAuth = async <T,>(fn: (client: ApiClient, token: string) => Promise<T>) =>
      fn(client, 'access-token');
    const actions = createLeavesActions(withAuth, {
      loadDashboard: async () => null,
      enqueueFreshCreate: async (input) => queue.enqueueWithTicket(serverUrl, actorId, 'create_leave', { input }),
      completeFreshCreate: async (id) => queue.dequeue(serverUrl, actorId, id),
      markFreshCreateForReview: async (id, message) =>
        queue.markFailed(serverUrl, actorId, id, message, 'manual_review'),
    });

    await actions.createLeave({ leaveDate: '2026-10-01', reason: 'Personal' });

    expect(client.createLeave).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ leaveDate: '2026-10-01' }),
      { idempotencyKey: 'mf_leave_wal' }
    );
    expect(await queue.list(serverUrl, actorId)).toEqual([]);
  });

  it('parks a rejected stale ticket for manual review without discarding the queued create', async () => {
    const queue = new OfflineQueue(new MemoryKvStore());
    await queue.addTickets(serverUrl, actorId, 'create_reminder', [
      { key: 'mf_pre_fence', expiresAt: new Date(Date.now() + 97 * 86400000).toISOString() },
    ]);
    const client = {
      createReminder: jest.fn().mockRejectedValue(
        new ApiClientError(409, {
          data: null,
          error: { code: 'IDEMPOTENCY_REVIEW_REQUIRED', message: 'Ticket predates the current fence.' },
        })
      ),
    } as unknown as ApiClient;
    const withAuth: WithAuth = async <T,>(fn: (client: ApiClient, token: string) => Promise<T>) =>
      fn(client, 'access-token');
    const actions = createRemindersActions(withAuth, {
      setGlobalReminders: (() => undefined) as never,
      loadGlobalReminders: async () => [],
      enqueueFreshCreate: async (input) => queue.enqueueWithTicket(serverUrl, actorId, 'create_reminder', { input }),
      completeFreshCreate: async (id) => queue.dequeue(serverUrl, actorId, id),
      markFreshCreateForReview: async (id, message) =>
        queue.markFailed(serverUrl, actorId, id, message, 'manual_review'),
    });

    await expect(
      actions.createReminder({ message: 'Retain for review', remindAt: '2026-10-01T09:00:00.000Z' })
    ).rejects.toThrow('Ticket predates the current fence.');

    const [retained] = await queue.list(serverUrl, actorId);
    expect(retained.status).toBe('manual_review');
    expect(retained.idempotencyKey).toBe('mf_pre_fence');
    expect(client.createReminder).toHaveBeenCalledTimes(1);
  });
});
