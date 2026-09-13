import { NativeModules } from 'react-native';
import {
  KvStoreError,
  type AsyncKeyValueStore,
  type KvStoreErrorCode,
  type NativeKvStorageModule,
} from './types';

const MODULE_NAME = 'VsisSecureStorage';

function mapNativeError(
  error: unknown,
  fallbackCode: KvStoreErrorCode,
  fallbackMessage: string
): KvStoreError {
  if (error instanceof KvStoreError) return error;

  const nativeCode =
    typeof error === 'string'
      ? error.toLowerCase()
      : error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? '').toLowerCase()
        : '';

  const code: KvStoreErrorCode =
    nativeCode === 'unavailable' ||
    nativeCode === 'locked' ||
    nativeCode === 'corrupt' ||
    nativeCode === 'capacity' ||
    nativeCode === 'invalid-key' ||
    nativeCode === 'read-failed' ||
    nativeCode === 'write-failed' ||
    nativeCode === 'delete-failed'
      ? (nativeCode as KvStoreErrorCode)
      : fallbackCode;

  return new KvStoreError(code, fallbackMessage);
}

export class NativeKvStore implements AsyncKeyValueStore {
  constructor(private readonly injectedModule?: NativeKvStorageModule) {}

  private module(): NativeKvStorageModule {
    if (this.injectedModule) {
      return this.injectedModule;
    }
    const modules = NativeModules as unknown as Record<string, unknown>;
    const module = modules[MODULE_NAME] as Partial<NativeKvStorageModule> | undefined;
    if (
      !module ||
      typeof module.readItem !== 'function' ||
      typeof module.writeItem !== 'function' ||
      typeof module.removeItem !== 'function'
    ) {
      throw new KvStoreError(
        'unavailable',
        'OS-backed key-value storage is unavailable on this build.'
      );
    }
    return module as NativeKvStorageModule;
  }

  async getItem(key: string): Promise<string | null> {
    if (!key || typeof key !== 'string' || !key.trim()) {
      throw new KvStoreError('invalid-key', 'Storage key cannot be empty.');
    }
    try {
      const raw = await this.module().readItem(key.trim());
      // Windows PasswordVault resolves "" for absent keys; iOS and Android resolve null.
      // Normalize empty string to null across all platforms.
      return !raw ? null : raw;
    } catch (error) {
      throw mapNativeError(error, 'read-failed', 'Failed to read from native storage.');
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    if (!key || typeof key !== 'string' || !key.trim()) {
      throw new KvStoreError('invalid-key', 'Storage key cannot be empty.');
    }
    if (typeof value !== 'string') {
      throw new KvStoreError('write-failed', 'Storage value must be a string.');
    }
    try {
      await this.module().writeItem(key.trim(), value);
    } catch (error) {
      throw mapNativeError(error, 'write-failed', 'Failed to write to native storage.');
    }
  }

  async removeItem(key: string): Promise<void> {
    if (!key || typeof key !== 'string' || !key.trim()) {
      throw new KvStoreError('invalid-key', 'Storage key cannot be empty.');
    }
    try {
      await this.module().removeItem(key.trim());
    } catch (error) {
      throw mapNativeError(error, 'delete-failed', 'Failed to remove from native storage.');
    }
  }
}
