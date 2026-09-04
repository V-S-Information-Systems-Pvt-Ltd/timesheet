import { ApiClient, ApiClientError } from '../api/client';
import {
  type QueuedOfflineMutation,
  OfflineQueue,
  offlineQueue,
} from '../storage/offline-queue';
import { TelemetryService, telemetry } from '../telemetry/telemetry';

export interface SyncResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export class SyncEngine {
  private queue: OfflineQueue;
  private tel: TelemetryService;
  private isSyncing = false;

  constructor(queue = offlineQueue, tel = telemetry) {
    this.queue = queue;
    this.tel = tel;
  }

  async flush(
    client: ApiClient,
    serverUrl: string,
    actorId: string,
    accessToken: string
  ): Promise<SyncResult> {
    if (this.isSyncing) {
      return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    }

    this.isSyncing = true;
    const startTime = Date.now();
    const result: SyncResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    try {
      const items = await this.queue.list(serverUrl, actorId);
      if (items.length === 0) {
        return result;
      }

      this.tel.log('sync_start', { count: items.length, serverUrl, actorId });

      for (const mutation of items) {
        result.processed++;
        const itemStartTime = Date.now();

        try {
          await this.processMutation(client, accessToken, mutation);
          await this.queue.dequeue(serverUrl, actorId, mutation.id);
          result.succeeded++;
          this.tel.log(
            'sync_item_success',
            { mutationId: mutation.id, type: mutation.type },
            Date.now() - itemStartTime
          );
        } catch (err) {
          result.failed++;
          const errorMsg = err instanceof Error ? err.message : 'Unknown sync error';
          result.errors.push(`${mutation.type}: ${errorMsg}`);

          this.tel.log(
            'sync_item_failure',
            { mutationId: mutation.id, type: mutation.type, error: errorMsg },
            Date.now() - itemStartTime
          );

          // If client validation error or resource gone (400, 404, 409, 422), discard to prevent infinite stall
          if (err instanceof ApiClientError && err.status >= 400 && err.status < 500 && err.status !== 429) {
            await this.queue.dequeue(serverUrl, actorId, mutation.id);
          } else {
            // Network or server failure: record retry and stop to preserve sequential ordering
            await this.queue.recordRetry(serverUrl, actorId, mutation.id, errorMsg);
            break;
          }
        }
      }

      this.tel.log(
        'sync_complete',
        { processed: result.processed, succeeded: result.succeeded, failed: result.failed },
        Date.now() - startTime
      );
    } finally {
      this.isSyncing = false;
    }

    return result;
  }

  private async processMutation(
    client: ApiClient,
    accessToken: string,
    mutation: QueuedOfflineMutation
  ): Promise<void> {
    const payload = mutation.payload as unknown as Record<string, unknown>;

    switch (mutation.type) {
      case 'create_timesheet': {
        const input = (payload as { input: Parameters<ApiClient['createTimesheet']>[1] }).input;
        await client.createTimesheet(accessToken, input);
        break;
      }
      case 'update_timesheet': {
        const { id, input } = payload as {
          id: string;
          input: Parameters<ApiClient['updateTimesheet']>[2];
        };
        await client.updateTimesheet(accessToken, id, input);
        break;
      }
      case 'delete_timesheet': {
        const { id } = payload as { id: string };
        await client.deleteTimesheet(accessToken, id);
        break;
      }
      case 'create_leave': {
        const input = (payload as { input: Parameters<ApiClient['createLeave']>[1] }).input;
        await client.createLeave(accessToken, input);
        break;
      }
      case 'delete_leave': {
        const { id } = payload as { id: string };
        await client.deleteLeave(accessToken, id);
        break;
      }
      case 'create_reminder': {
        const input = (payload as { input: Parameters<ApiClient['createReminder']>[1] }).input;
        await client.createReminder(accessToken, input);
        break;
      }
      case 'update_reminder': {
        const { id, done } = payload as { id: string; done: boolean };
        await client.updateReminder(accessToken, id, done);
        break;
      }
      case 'delete_reminder': {
        const { id } = payload as { id: string };
        await client.deleteReminder(accessToken, id);
        break;
      }
    }
  }

  getIsSyncing(): boolean {
    return this.isSyncing;
  }
}

export const syncEngine = new SyncEngine();
