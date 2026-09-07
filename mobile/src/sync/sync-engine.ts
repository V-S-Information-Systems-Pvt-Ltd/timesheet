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

/**
 * Absolute offline replay boundary (T19.2): items older than this are moved
 * to user-visible `manual_review` instead of auto-replayed or deleted.
 * Keep in sync with server ledger retention (`cleanupIdempotencyKeys` default
 * 97 = 90 + 7-day grace) — change both together if product extends offline life.
 */
export const OFFLINE_REPLAY_MAX_AGE_DAYS = 90;

/**
 * Maximum automatic retry attempts for transient sync failures before escalating
 * to user-visible `manual_review` state to prevent unbounded retry loops.
 */
export const MAX_AUTO_RETRIES = 10;

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
        // Skip items that are in failed or manual_review state (they require user review/retry)
        if (mutation.status === 'failed' || mutation.status === 'manual_review') {
          continue;
        }

        // Enforce 90-day absolute offline replay boundary: transition to manual_review
        const mutationAgeMs = Date.now() - new Date(mutation.createdAt).getTime();
        if (mutationAgeMs > OFFLINE_REPLAY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
          result.failed++;
          result.errors.push(`${mutation.type}: mutation exceeded 90-day offline threshold (manual review required)`);
          await this.queue.markFailed(
            serverUrl,
            actorId,
            mutation.id,
            'Exceeded 90-day offline threshold (manual review required)',
            'manual_review'
          );
          continue;
        }

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

          const isIdempotencyCommitUnknown =
            err instanceof ApiClientError &&
            err.status === 409 &&
            (err.code === 'IDEMPOTENCY_COMMIT_UNKNOWN' ||
              errorMsg.toLowerCase().includes('already completed') ||
              errorMsg.includes('IDEMPOTENCY_COMMIT_UNKNOWN'));

          const isIdempotencyInFlight =
            err instanceof ApiClientError &&
            err.status === 409 &&
            (err.code === 'IDEMPOTENCY_IN_FLIGHT' ||
              errorMsg.toLowerCase().includes('in flight') ||
              errorMsg.includes('IDEMPOTENCY_IN_FLIGHT'));

          const recordRetryOrCap = async () => {
            if (mutation.retryCount + 1 >= MAX_AUTO_RETRIES) {
              await this.queue.markFailed(
                serverUrl,
                actorId,
                mutation.id,
                `Exceeded maximum retries (${MAX_AUTO_RETRIES}) — manual review required: ${errorMsg}`,
                'manual_review'
              );
            } else {
              await this.queue.recordRetry(serverUrl, actorId, mutation.id, errorMsg);
            }
          };

          if (isIdempotencyCommitUnknown) {
            // Already committed on server but ledger commit was unrecorded:
            // transition to manual_review instead of retrying or parking.
            await this.queue.markFailed(
              serverUrl,
              actorId,
              mutation.id,
              'already completed — refresh and review',
              'manual_review'
            );
          } else if (
            (err instanceof ApiClientError &&
              (err.status === 401 || err.status === 403 || err.status === 429 || err.status === 503)) ||
            isIdempotencyInFlight
          ) {
            // Transient auth, rate limit, disabled API (401, 403, 429, 503), or in-flight idempotency lock: retain and pause sync
            await recordRetryOrCap();
            break;
          } else if (
            err instanceof ApiClientError &&
            err.status >= 400 &&
            err.status < 500
          ) {
            // Validation or permanent conflict error: retain in user-visible failed state instead of discarding user work
            await this.queue.markFailed(serverUrl, actorId, mutation.id, errorMsg, 'failed');
          } else {
            // Network or server failure: record retry and stop to preserve sequential ordering
            await recordRetryOrCap();
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
        await client.createTimesheet(accessToken, input, { idempotencyKey: mutation.id });
        break;
      }
      case 'update_timesheet': {
        const { id, input } = payload as {
          id: string;
          input: Parameters<ApiClient['updateTimesheet']>[2];
        };
        await client.updateTimesheet(accessToken, id, input, { idempotencyKey: mutation.id });
        break;
      }
      case 'delete_timesheet': {
        const { id } = payload as { id: string };
        await client.deleteTimesheet(accessToken, id, { idempotencyKey: mutation.id });
        break;
      }
      case 'create_leave': {
        const input = (payload as { input: Parameters<ApiClient['createLeave']>[1] }).input;
        await client.createLeave(accessToken, input, { idempotencyKey: mutation.id });
        break;
      }
      case 'delete_leave': {
        const { id } = payload as { id: string };
        await client.deleteLeave(accessToken, id, { idempotencyKey: mutation.id });
        break;
      }
      case 'create_reminder': {
        const input = (payload as { input: Parameters<ApiClient['createReminder']>[1] }).input;
        await client.createReminder(accessToken, input, { idempotencyKey: mutation.id });
        break;
      }
      case 'update_reminder': {
        const { id, done } = payload as { id: string; done: boolean };
        await client.updateReminder(accessToken, id, done, { idempotencyKey: mutation.id });
        break;
      }
      case 'delete_reminder': {
        const { id } = payload as { id: string };
        await client.deleteReminder(accessToken, id, { idempotencyKey: mutation.id });
        break;
      }
    }
  }

  getIsSyncing(): boolean {
    return this.isSyncing;
  }
}

export const syncEngine = new SyncEngine();
