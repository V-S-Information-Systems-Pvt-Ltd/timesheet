import type { SecureTokenStore, StoredTokens } from './types';

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
