export interface StoredTokens {
  refreshToken: string;
  sessionId: string;
}

export interface SecureTokenStore {
  read(): Promise<StoredTokens | null>;
  write(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}
