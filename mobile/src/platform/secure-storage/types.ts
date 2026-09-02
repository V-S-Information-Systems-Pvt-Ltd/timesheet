export interface StoredTokens {
  refreshToken: string;
  sessionId: string;
}

export type SecureStorageErrorCode =
  | 'unavailable'
  | 'locked'
  | 'corrupt'
  | 'read-failed'
  | 'write-failed'
  | 'delete-failed';

export class SecureStorageError extends Error {
  readonly code: SecureStorageErrorCode;

  constructor(code: SecureStorageErrorCode, message: string) {
    super(message);
    this.name = 'SecureStorageError';
    this.code = code;
  }
}

export interface SecureTokenStore {
  read(): Promise<StoredTokens | null>;
  write(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}
