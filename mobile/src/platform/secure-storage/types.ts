/**
 * Contract every platform adapter must satisfy. Production stores must be
 * backed by the OS credential locker (Android Keystore, iOS Keychain,
 * Windows PasswordVault). The in-memory store is for tests and local
 * wiring only and must never ship as a release fallback.
 */
export interface StoredTokens {
  refreshToken: string;
  sessionId: string;
  /** Approved server base URL persisted alongside the session identity. */
  baseUrl?: string;
}

export interface SecureTokenStore {
  read(): Promise<StoredTokens | null>;
  write(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}

/** Raised when no OS-backed store can be created on this device. */
export class SecureStorageUnavailableError extends Error {
  constructor(platformLabel: string) {
    super(`Secure storage is not available on ${platformLabel}.`);
    this.name = 'SecureStorageUnavailableError';
  }
}
