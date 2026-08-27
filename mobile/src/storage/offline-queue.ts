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

export interface QueuedOfflineMutation {
  id: string;
  type: OfflineMutationType;
  payload: OfflineMutationPayload;
  createdAt: string;
  retryCount: number;
  lastError?: string | null;
}

interface GlobalScope {
  localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
}

function getGlobalScope(): GlobalScope {
  return globalThis as unknown as GlobalScope;
}

export class OfflineQueue {
  private inMemory = new Map<string, QueuedOfflineMutation[]>();

  private getStorageKey(serverUrl: string, actorId: string): string {
    return `vsis_offline_queue_${serverUrl}_${actorId}`;
  }

  async list(serverUrl: string, actorId: string): Promise<QueuedOfflineMutation[]> {
    const key = this.getStorageKey(serverUrl, actorId);
    if (this.inMemory.has(key)) {
      return [...(this.inMemory.get(key) || [])];
    }

    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        const raw = scope.localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this.inMemory.set(key, parsed);
            return [...parsed];
          }
        }
      }
    } catch {
      // Ignore read errors
    }

    this.inMemory.set(key, []);
    return [];
  }

  private async persist(serverUrl: string, actorId: string, items: QueuedOfflineMutation[]): Promise<void> {
    const key = this.getStorageKey(serverUrl, actorId);
    this.inMemory.set(key, items);

    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        scope.localStorage.setItem(key, JSON.stringify(items));
      }
    } catch {
      // Ignore write errors
    }
  }

  async enqueue<T extends OfflineMutationType>(
    serverUrl: string,
    actorId: string,
    type: T,
    payload: OfflineMutationPayloadMap[T]
  ): Promise<QueuedOfflineMutation> {
    const items = await this.list(serverUrl, actorId);
    const item: QueuedOfflineMutation = {
      id: `mut_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type,
      payload,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      lastError: null,
    };

    items.push(item);
    await this.persist(serverUrl, actorId, items);
    return item;
  }

  async dequeue(serverUrl: string, actorId: string, mutationId: string): Promise<void> {
    const items = await this.list(serverUrl, actorId);
    const filtered = items.filter((m) => m.id !== mutationId);
    await this.persist(serverUrl, actorId, filtered);
  }

  async recordRetry(
    serverUrl: string,
    actorId: string,
    mutationId: string,
    errorMessage: string
  ): Promise<void> {
    const items = await this.list(serverUrl, actorId);
    const index = items.findIndex((m) => m.id === mutationId);
    if (index >= 0) {
      items[index] = {
        ...items[index],
        retryCount: items[index].retryCount + 1,
        lastError: errorMessage,
      };
      await this.persist(serverUrl, actorId, items);
    }
  }

  async clear(serverUrl: string, actorId: string): Promise<void> {
    const key = this.getStorageKey(serverUrl, actorId);
    this.inMemory.delete(key);
    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        scope.localStorage.removeItem(key);
      }
    } catch {
      // Ignore clear errors
    }
  }

  async size(serverUrl: string, actorId: string): Promise<number> {
    const items = await this.list(serverUrl, actorId);
    return items.length;
  }
}

export const offlineQueue = new OfflineQueue();
