import type { SecureTokenStore, StoredTokens } from '../platform/secure-storage/types';

export type { SecureTokenStore, StoredTokens } from '../platform/secure-storage/types';

/**
 * Test/local wiring only. Production must use the OS-backed adapters from
 * `../platform/secure-storage`; never register this store in a release build.
 */
export class MemoryTokenStore implements SecureTokenStore {
  private tokens: StoredTokens | null = null;

  async read(): Promise<StoredTokens | null> {
    return this.tokens;
  }

  async write(tokens: StoredTokens): Promise<void> {
    this.tokens = { ...tokens };
  }

  async clear(): Promise<void> {
    this.tokens = null;
  }
}
