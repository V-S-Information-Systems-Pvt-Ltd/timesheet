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
  /**
   * Original creation time. Never rewritten on retry: the 90-day offline
   * replay limit and the server's queue-age review both read this field, so
   * re-aging a stale item here would smuggle it back into automatic replay.
   */
  createdAt: string;
  /** Deployment the item targets, captured at enqueue time and never changed. Items enqueued before this field existed may not carry it. */
  origin?: string;
  /** Present only when a server-issued fresh-operation ticket was assigned at enqueue. */
  idempotencyKey?: string;
  /** Last manual-retry time, kept separately from the immutable createdAt. */
  lastRetriedAt?: string | null;
  retryCount: number;
  lastError?: string | null;
  status?: OfflineMutationStatus;
}

export interface EnqueueOptions {
  /** Reuse the original request key when a timed-out write is retried later. */
  id?: string;
}

export type FreshOperation = 'create_reminder' | 'create_leave';

export interface FreshOperationTicket {
  key: string;
  expiresAt: string;
}

interface QueueState {
  items: QueuedOfflineMutation[];
  tickets: Partial<Record<FreshOperation, FreshOperationTicket[]>>;
}

import {
  defaultKvStore,
  KvStoreError,
  type AsyncKeyValueStore,
} from '../platform/kv-store';

export const MAX_OFFLINE_QUEUE_ITEMS = 100;
const MIN_TICKET_REPLAY_REMAINING_MS = 90 * 24 * 60 * 60 * 1000;

export class OfflineQueue {
  private inMemory = new Map<string, QueueState>();
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

  private async readStateUnderLock(key: string): Promise<QueueState> {
    if (this.inMemory.has(key)) {
      return this.inMemory.get(key)!;
    }

    const raw = await this.store.getItem(key);
    if (!raw) {
      const empty = { items: [], tickets: {} };
      this.inMemory.set(key, empty);
      return empty;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new KvStoreError('corrupt', 'Stored queue data is corrupt.');
    }

    if (Array.isArray(parsed)) {
      const migrated = { items: parsed as QueuedOfflineMutation[], tickets: {} };
      this.inMemory.set(key, migrated);
      return migrated;
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as QueueState).items)) {
      throw new KvStoreError('corrupt', 'Stored queue data is not a valid list.');
    }

    const record = parsed as QueueState;
    const state: QueueState = {
      items: record.items,
      tickets: record.tickets && typeof record.tickets === 'object' ? record.tickets : {},
    };
    this.inMemory.set(key, state);
    return state;
  }

  private async persistStateUnderLock(key: string, state: QueueState): Promise<void> {
    await this.store.setItem(key, JSON.stringify({ version: 2, ...state }));
    this.inMemory.set(key, state);
  }

  async list(serverUrl: string, actorId: string): Promise<QueuedOfflineMutation[]> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const state = await this.readStateUnderLock(key);
      return [...state.items];
    });
  }

  async enqueue<T extends OfflineMutationType>(
    serverUrl: string,
    actorId: string,
    type: T,
    payload: OfflineMutationPayloadMap[T],
    options?: EnqueueOptions
  ): Promise<QueuedOfflineMutation> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const state = await this.readStateUnderLock(key);
      const items = state.items;
      const id = options?.id ?? `mut_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const existing = items.find((item) => item.id === id);
      if (existing) {
        return existing;
      }

      if (items.length >= MAX_OFFLINE_QUEUE_ITEMS) {
        throw new KvStoreError(
          'capacity',
          `Offline queue capacity exceeded (maximum ${MAX_OFFLINE_QUEUE_ITEMS} items). Sync or discard existing items.`
        );
      }

      const item: QueuedOfflineMutation = {
        id,
        type,
        payload,
        createdAt: new Date().toISOString(),
        origin: serverUrl,
        lastRetriedAt: null,
        retryCount: 0,
        lastError: null,
        status: 'queued',
      };

      const updated = [...items, item];
      // Durable write before in-memory update
      await this.persistStateUnderLock(key, { ...state, items: updated });
      return item;
    });
  }

  async getTicketCount(serverUrl: string, actorId: string, operation: FreshOperation): Promise<number> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const state = await this.readStateUnderLock(key);
      const now = Date.now();
      const tickets = (state.tickets[operation] ?? []).filter(
        (ticket) => Date.parse(ticket.expiresAt) - now >= MIN_TICKET_REPLAY_REMAINING_MS
      );
      if (tickets.length !== (state.tickets[operation] ?? []).length) {
        await this.persistStateUnderLock(key, {
          ...state,
          tickets: { ...state.tickets, [operation]: tickets },
        });
      }
      return tickets.length;
    });
  }

  async addTickets(
    serverUrl: string,
    actorId: string,
    operation: FreshOperation,
    incoming: FreshOperationTicket[],
    options: { replaceExisting?: boolean } = {}
  ): Promise<void> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const state = await this.readStateUnderLock(key);
      const now = Date.now();
      const tickets = options.replaceExisting
        ? []
        : (state.tickets[operation] ?? []).filter(
            (ticket) => Date.parse(ticket.expiresAt) - now >= MIN_TICKET_REPLAY_REMAINING_MS
          );
      const seen = new Set(tickets.map((ticket) => ticket.key));
      for (const ticket of incoming) {
        if (ticket && typeof ticket.key === 'string' && ticket.key.length > 0 &&
            typeof ticket.expiresAt === 'string' &&
            Date.parse(ticket.expiresAt) - now >= MIN_TICKET_REPLAY_REMAINING_MS &&
            !seen.has(ticket.key)) {
          tickets.push({ key: ticket.key, expiresAt: ticket.expiresAt });
          seen.add(ticket.key);
        }
      }
      await this.persistStateUnderLock(key, {
        ...state,
        tickets: { ...state.tickets, [operation]: tickets },
      });
    });
  }

  async clearTickets(serverUrl: string, actorId: string, operation: FreshOperation): Promise<void> {
    await this.addTickets(serverUrl, actorId, operation, [], { replaceExisting: true });
  }

  async enqueueWithTicket<T extends FreshOperation>(
    serverUrl: string,
    actorId: string,
    type: T,
    payload: OfflineMutationPayloadMap[T],
    options?: EnqueueOptions
  ): Promise<QueuedOfflineMutation> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const state = await this.readStateUnderLock(key);
      const existingId = options?.id;
      const existing = existingId ? state.items.find((item) => item.id === existingId) : undefined;
      if (existing) return existing;
      if (state.items.length >= MAX_OFFLINE_QUEUE_ITEMS) {
        throw new KvStoreError(
          'capacity',
          `Offline queue capacity exceeded (maximum ${MAX_OFFLINE_QUEUE_ITEMS} items). Sync or discard existing items.`
        );
      }

      const now = Date.now();
      const tickets = (state.tickets[type] ?? []).filter(
        (ticket) => Date.parse(ticket.expiresAt) - now >= MIN_TICKET_REPLAY_REMAINING_MS
      );
      const ticket = tickets.shift();
      if (!ticket) {
        if (tickets.length !== (state.tickets[type] ?? []).length) {
          await this.persistStateUnderLock(key, { ...state, tickets: { ...state.tickets, [type]: tickets } });
        }
        throw new Error(`Cannot queue this ${type === 'create_reminder' ? 'reminder' : 'leave request'} while offline: no unused server-issued ticket is available. Reconnect and try again.`);
      }

      const item: QueuedOfflineMutation = {
        id: options?.id ?? `mut_${now}_${Math.random().toString(36).slice(2, 9)}`,
        type,
        payload,
        idempotencyKey: ticket.key,
        createdAt: new Date(now).toISOString(),
        origin: serverUrl,
        lastRetriedAt: null,
        retryCount: 0,
        lastError: null,
        status: 'queued',
      };
      await this.persistStateUnderLock(key, {
        items: [...state.items, item],
        tickets: { ...state.tickets, [type]: tickets },
      });
      return item;
    });
  }

  async dequeue(serverUrl: string, actorId: string, mutationId: string): Promise<void> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const state = await this.readStateUnderLock(key);
      const items = state.items;
      const filtered = items.filter((m) => m.id !== mutationId);
      await this.persistStateUnderLock(key, { ...state, items: filtered });
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
      const state = await this.readStateUnderLock(key);
      const items = state.items;
      const index = items.findIndex((m) => m.id === mutationId);
      if (index >= 0) {
        const updated = [...items];
        updated[index] = {
          ...items[index],
          retryCount: items[index].retryCount + 1,
          lastError: errorMessage,
        };
        await this.persistStateUnderLock(key, { ...state, items: updated });
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
      const state = await this.readStateUnderLock(key);
      const items = state.items;
      const index = items.findIndex((m) => m.id === mutationId);
      if (index >= 0) {
        const updated = [...items];
        updated[index] = {
          ...items[index],
          status,
          lastError: errorMessage,
        };
        await this.persistStateUnderLock(key, { ...state, items: updated });
      }
    });
  }

  async retryMutation(serverUrl: string, actorId: string, mutationId: string): Promise<void> {
    const key = this.getStorageKey(serverUrl, actorId);
    return this.withLock(key, async () => {
      const state = await this.readStateUnderLock(key);
      const items = state.items;
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
          // createdAt and origin are immutable: a manual retry must not
          // re-age a stale item past the 90-day replay limit or re-home it
          // to a different deployment.
          lastRetriedAt: new Date().toISOString(),
        };
        await this.persistStateUnderLock(key, { ...state, items: updated });
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
