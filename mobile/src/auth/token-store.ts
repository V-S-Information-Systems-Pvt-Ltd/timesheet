export interface StoredTokens {
  refreshToken: string;
  sessionId: string;
}

/**
 * The app depends on this interface only. Production adapters must use the
 * OS credential locker; this in-memory implementation is for tests and local
 * wiring only and must never be used as a release fallback.
 */
export interface SecureTokenStore {
  read(): Promise<StoredTokens | null>;
  write(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}

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
