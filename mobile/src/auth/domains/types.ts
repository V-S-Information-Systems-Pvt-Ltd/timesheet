import type { ApiClient } from '../../api/client';
import { ApiClientError } from '../../api/client';
import { SecureStorageError } from '../../platform/secure-storage/types';

export interface AuthCallOptions<T> {
  defaultValue?: T;
  errorMessage?: string;
  /**
   * Runs only after a request failed before the server produced an HTTP
   * response. Callers use this to durably queue an idempotent mutation.
   */
  onNetworkFailure?: () => Promise<T>;
}

export type WithAuth = <T>(
  fn: (client: ApiClient, token: string) => Promise<T>,
  options?: AuthCallOptions<T>
) => Promise<T>;

/** Network and timeout failures have no reliable HTTP response to inspect. */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof ApiClientError || error instanceof SecureStorageError || !(error instanceof Error)) {
    return false;
  }

  if (error instanceof TypeError || error.name === 'AbortError' || error.name === 'TimeoutError') {
    return true;
  }

  return /network (request |error)|failed to fetch|fetch failed|offline|timed? out/i.test(error.message);
}
