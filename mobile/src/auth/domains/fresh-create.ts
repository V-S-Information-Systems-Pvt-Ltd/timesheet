import { ApiClientError, type ApiClient } from '../../api/client';
import type { QueuedOfflineMutation } from '../../storage/offline-queue';
import { isNetworkFailure, type WithAuth } from './types';

export interface FreshCreateCallbacks<TInput> {
  enqueueFreshCreate: (input: TInput) => Promise<QueuedOfflineMutation>;
  completeFreshCreate: (mutationId: string) => Promise<void>;
  markFreshCreateForReview: (mutationId: string, message: string) => Promise<void>;
}

/**
 * Write the ticketed mutation before its first request. If the response is
 * ambiguous, keep that exact item so replay uses the same server-issued key.
 */
export async function createFreshMutation<TInput>(
  withAuth: WithAuth,
  input: TInput,
  send: (client: ApiClient, token: string, input: TInput, key: string) => Promise<unknown>,
  callbacks: FreshCreateCallbacks<TInput>,
  errorMessage: string
): Promise<void> {
  const mutation = await callbacks.enqueueFreshCreate(input);
  const key = mutation.idempotencyKey;
  if (!key) {
    throw new Error('Cannot safely send this create because its queued item has no server-issued ticket.');
  }

  try {
    await withAuth((client, token) => send(client, token, input, key), { errorMessage });
    await callbacks.completeFreshCreate(mutation.id);
  } catch (error) {
    if (isNetworkFailure(error)) {
      // The server may have committed before the connection failed. The
      // queued item is the write-ahead record and must be replayed with `key`.
      return;
    }

    if (error instanceof ApiClientError) {
      if (
        error.status === 409 &&
        (error.code === 'IDEMPOTENCY_REVIEW_REQUIRED' || error.code === 'IDEMPOTENCY_COMMIT_UNKNOWN')
      ) {
        await callbacks.markFreshCreateForReview(mutation.id, error.message);
        throw error;
      }
      if (error.status >= 500 || [408, 409, 425, 429].includes(error.status)) {
        // These responses can follow a committed write or represent a
        // transient refusal. Retain the write-ahead item for keyed replay.
        return;
      }
      if (error.status >= 400 && error.status < 500 && error.status !== 401) {
        // A definite client rejection did not create the resource; remove the
        // pending item so it cannot later become an unexpected write.
        await callbacks.completeFreshCreate(mutation.id);
      }
    }
    throw error;
  }
}
