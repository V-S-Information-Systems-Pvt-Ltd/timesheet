export type KvStoreErrorCode =
  | 'unavailable'
  | 'locked'
  | 'corrupt'
  | 'read-failed'
  | 'write-failed'
  | 'delete-failed'
  | 'invalid-key'
  | 'capacity';

export class KvStoreError extends Error {
  readonly code: KvStoreErrorCode;

  constructor(code: KvStoreErrorCode, message: string) {
    super(message);
    this.name = 'KvStoreError';
    this.code = code;
  }
}

export interface AsyncKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface NativeKvStorageModule {
  readItem(key: string): Promise<string | null>;
  writeItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
