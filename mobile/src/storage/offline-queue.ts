import type {
  CreateLeaveInput,
  CreateReminderInput,
  CreateTimesheetInput,
} from '../api/contracts';

export type OfflineMutationType =
  | 'create_timesheet'
  | 'update_timesheet'
  | 'delete_timesheet'
  | 'create_leave'
  | 'delete_leave'
  | 'create_reminder'
  | 'update_reminder'
  | 'delete_reminder';

export interface CreateTimesheetMutationPayload {
  input: CreateTimesheetInput;
}

export interface UpdateTimesheetMutationPayload {
  id: string;
  input: CreateTimesheetInput;
}

export interface DeleteTimesheetMutationPayload {
  id: string;
}

export interface CreateLeaveMutationPayload {
  input: CreateLeaveInput;
}

export interface DeleteLeaveMutationPayload {
  id: string;
}

export interface CreateReminderMutationPayload {
  input: CreateReminderInput;
}

export interface UpdateReminderMutationPayload {
  id: string;
  done: boolean;
}

export interface DeleteReminderMutationPayload {
  id: string;
}

export type OfflineMutationPayload =
  | CreateTimesheetMutationPayload
  | UpdateTimesheetMutationPayload
  | DeleteTimesheetMutationPayload
  | CreateLeaveMutationPayload
  | DeleteLeaveMutationPayload
  | CreateReminderMutationPayload
  | UpdateReminderMutationPayload
  | DeleteReminderMutationPayload;

export type OfflineMutationPayloadMap = {
  create_timesheet: CreateTimesheetMutationPayload;
  update_timesheet: UpdateTimesheetMutationPayload;
  delete_timesheet: DeleteTimesheetMutationPayload;
  create_leave: CreateLeaveMutationPayload;
  delete_leave: DeleteLeaveMutationPayload;
  create_reminder: CreateReminderMutationPayload;
  update_reminder: UpdateReminderMutationPayload;
  delete_reminder: DeleteReminderMutationPayload;
};

export type OfflineMutationStatus = 'queued' | 'failed' | 'manual_review';

export interface QueuedOfflineMutation {
  id: string;
  type: OfflineMutationType;
  payload: OfflineMutationPayload;
  createdAt: string;
  retryCount: number;
  lastError?: string | null;
  status?: OfflineMutationStatus;
}

import {
  defaultKvStore,
  KvStoreError,
  type AsyncKeyValueStore,
} from '../platform/kv-store';

export const MAX_OFFLINE_QUEUE_ITEMS = 100;

export class OfflineQueue {
  private inMemory = new Map<string, QueuedOfflineMutation[]>();
  private locks = new Map<string, Promise<unknown>>();

  constructor(private readonly store: AsyncKeyValueStore = defaultKvStore) {}

  private getStorageKey(serverUrl: string, actorId: string): string {
    return `vsis_offline_queue_${serverUrl}_${actorId}`;
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const current = this.locks.get(key) ?? Promise.resolve();
    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      key,
      current.then(
        () => next,
        () => next
      )
    );
    try {
      await current;
      return await fn();
    } finally {
      release!();
      if (this.locks.get(key) === next) {
        this.locks.delete(key);
      }
    }
  }

  private async readItemsUnderLock(key: string): Promise<QueuedOfflineMutation[]> {
    if (this.inMemory.has(key)) {
      return this.inMemory.get(key)!;
    }

    const raw = await this.store.getItem(key);
    if (!raw) {
      this.inMemory.set(key, []);
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new KvStoreError('corrupt', 'Stored queue data is corrupt.');
    }

    if (!Array.isArray(parsed)) {
      throw new KvStoreError('corrupt', 'Stored queue data is not a valid list.');
    }

    this.inMemory.set(key, parsed as QueuedOfflineMutation[]);
    return parsed as QueuedOfflineMutation[];
  }

  async list(serverUrl: string, actorId: string): Promise<QueuedOfflineMutation[]> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const items = await this.readItemsUnderLock(key);
      return [...items];
    });
  }

  async enqueue<T extends OfflineMutationType>(
    serverUrl: string,
    actorId: string,
    type: T,
    payload: OfflineMutationPayloadMap[T]
  ): Promise<QueuedOfflineMutation> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const items = await this.readItemsUnderLock(key);
      if (items.length >= MAX_OFFLINE_QUEUE_ITEMS) {
        throw new KvStoreError(
          'capacity',
          `Offline queue capacity exceeded (maximum ${MAX_OFFLINE_QUEUE_ITEMS} items). Sync or discard existing items.`
        );
      }
      const item: QueuedOfflineMutation = {
        id: `mut_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        type,
        payload,
        createdAt: new Date().toISOString(),
        retryCount: 0,
        lastError: null,
        status: 'queued',
      };

      const updated = [...items, item];
      // Durable write before in-memory update
      await this.store.setItem(key, JSON.stringify(updated));
      this.inMemory.set(key, updated);
      return item;
    });
  }

  async dequeue(serverUrl: string, actorId: string, mutationId: string): Promise<void> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const items = await this.readItemsUnderLock(key);
      const filtered = items.filter((m) => m.id !== mutationId);
      await this.store.setItem(key, JSON.stringify(filtered));
      this.inMemory.set(key, filtered);
    });
  }

  async recordRetry(
    serverUrl: string,
    actorId: string,
    mutationId: string,
    errorMessage: string
  ): Promise<void> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const items = await this.readItemsUnderLock(key);
      const index = items.findIndex((m) => m.id === mutationId);
      if (index >= 0) {
        const updated = [...items];
        updated[index] = {
          ...items[index],
          retryCount: items[index].retryCount + 1,
          lastError: errorMessage,
        };
        await this.store.setItem(key, JSON.stringify(updated));
        this.inMemory.set(key, updated);
      }
    });
  }

  async markFailed(
    serverUrl: string,
    actorId: string,
    mutationId: string,
    errorMessage: string,
    status: 'failed' | 'manual_review' = 'failed'
  ): Promise<void> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const items = await this.readItemsUnderLock(key);
      const index = items.findIndex((m) => m.id === mutationId);
      if (index >= 0) {
        const updated = [...items];
        updated[index] = {
          ...items[index],
          status,
          lastError: errorMessage,
        };
        await this.store.setItem(key, JSON.stringify(updated));
        this.inMemory.set(key, updated);
      }
    });
  }

  async retryMutation(serverUrl: string, actorId: string, mutationId: string): Promise<void> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const items = await this.readItemsUnderLock(key);
      const index = items.findIndex((m) => m.id === mutationId);
      if (index >= 0) {
        const target = items[index];
        const isCommittedUnknown = Boolean(
          target.lastError &&
          (target.lastError.toLowerCase().includes('already completed') ||
           target.lastError.includes('IDEMPOTENCY_COMMIT_UNKNOWN'))
        );
        if (isCommittedUnknown) {
          // Mutations that already completed on the server cannot be retried;
          // they must be discarded after user review.
          return;
        }

        const updated = [...items];
        updated[index] = {
          ...target,
          status: 'queued',
          lastError: null,
          retryCount: 0,
          createdAt: new Date().toISOString(),
        };
        await this.store.setItem(key, JSON.stringify(updated));
        this.inMemory.set(key, updated);
      }
    });
  }

  async discardMutation(serverUrl: string, actorId: string, mutationId: string): Promise<void> {
    return this.dequeue(serverUrl, actorId, mutationId);
  }

  async getQueueSummary(
    serverUrl: string,
    actorId: string
  ): Promise<{ pendingCount: number; failedCount: number; failedItems: QueuedOfflineMutation[] }> {
    const items = await this.list(serverUrl, actorId);
    const failedItems = items.filter((m) => m.status === 'failed' || m.status === 'manual_review');
    const pendingCount = items.length - failedItems.length;
    return {
      pendingCount,
      failedCount: failedItems.length,
      failedItems,
    };
  }

  async clear(serverUrl: string, actorId: string): Promise<void> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      await this.store.removeItem(key);
      this.inMemory.delete(key);
    });
  }

  async size(serverUrl: string, actorId: string): Promise<number> {
    const items = await this.list(serverUrl, actorId);
    return items.length;
  }
}

export const offlineQueue = new OfflineQueue();

