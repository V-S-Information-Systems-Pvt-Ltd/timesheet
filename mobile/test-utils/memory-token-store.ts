import type { SecureTokenStore, StoredTokens } from '../src/platform/secure-storage/types';

/** In-memory test double; never use this store for production credentials. */
export class MemoryTokenStore implements SecureTokenStore {
  private tokens: StoredTokens | null = null;

  async read(): Promise<StoredTokens | null> {
    return this.tokens ? { ...this.tokens } : null;
  }

  async write(tokens: StoredTokens): Promise<void> {
    this.tokens = { ...tokens };
  }

  async clear(): Promise<void> {
    this.tokens = null;
  }
}
