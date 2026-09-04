import { NativeModules } from 'react-native';

import { clearLegacyBrowserCredential } from '../legacy-credential-cleanup';
import {
  SecureStorageError,
  type SecureTokenStore,
  type StoredTokens,
} from './types';

const MODULE_NAME = 'VsisSecureStorage';
const PAYLOAD_VERSION = 1;

export interface NativeSecureStorageModule {
  read(): Promise<string | null>;
  write(payload: string): Promise<void>;
  clear(): Promise<void>;
  clearLegacy(): Promise<void>;
}

interface StoredTokenPayload extends StoredTokens {
  version: typeof PAYLOAD_VERSION;
}

function getNativeModule(): NativeSecureStorageModule {
  const modules = NativeModules as unknown as Record<string, unknown>;
  const module = modules[MODULE_NAME] as Partial<NativeSecureStorageModule> | undefined;
  if (
    !module ||
    typeof module.read !== 'function' ||
    typeof module.write !== 'function' ||
    typeof module.clear !== 'function' ||
    typeof module.clearLegacy !== 'function'
  ) {
    throw new SecureStorageError(
      'unavailable',
      'OS-backed secure storage is unavailable on this build.',
    );
  }
  return module as NativeSecureStorageModule;
}

function parseStoredTokens(raw: string): StoredTokens {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SecureStorageError('corrupt', 'Stored credentials are invalid.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Partial<StoredTokenPayload>).version !== PAYLOAD_VERSION ||
    typeof (parsed as Partial<StoredTokenPayload>).refreshToken !== 'string' ||
    typeof (parsed as Partial<StoredTokenPayload>).sessionId !== 'string' ||
    !(parsed as Partial<StoredTokenPayload>).refreshToken ||
    !(parsed as Partial<StoredTokenPayload>).sessionId
  ) {
    throw new SecureStorageError('corrupt', 'Stored credentials are invalid.');
  }

  return {
    refreshToken: (parsed as StoredTokenPayload).refreshToken,
    sessionId: (parsed as StoredTokenPayload).sessionId,
  };
}

function mapNativeError(error: unknown, fallbackCode: SecureStorageError['code'], fallbackMessage: string): SecureStorageError {
  if (error instanceof SecureStorageError) return error;

  const nativeCode =
    typeof error === 'string'
      ? error.toLowerCase()
      : error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? '').toLowerCase()
        : '';
  const code =
    nativeCode === 'unavailable' || nativeCode === 'locked' || nativeCode === 'corrupt'
      ? nativeCode
      : nativeCode === 'read-failed' || nativeCode === 'write-failed' || nativeCode === 'delete-failed'
        ? nativeCode
        : fallbackCode;
  return new SecureStorageError(code, fallbackMessage);
}

/**
 * Production secure-token adapter. Native platform modules own persistence;
 * JavaScript never falls back to files, browser storage, or memory.
 */
export class NativeTokenStore implements SecureTokenStore {
  private legacyCleanup: Promise<void> | null = null;

  constructor(private readonly injectedModule?: NativeSecureStorageModule) {}

  private module(): NativeSecureStorageModule {
    return this.injectedModule ?? getNativeModule();
  }

  private clearLegacy(): Promise<void> {
    if (!this.legacyCleanup) {
      this.legacyCleanup = (async () => {
        await clearLegacyBrowserCredential();
        try {
          await this.module().clearLegacy();
        } catch (error) {
          throw mapNativeError(error, 'delete-failed', 'Legacy credential cleanup failed.');
        }
      })();
    }
    return this.legacyCleanup;
  }

  async read(): Promise<StoredTokens | null> {
    await this.clearLegacy();
    let raw: string | null;
    try {
      raw = await this.module().read();
    } catch (error) {
      throw mapNativeError(error, 'read-failed', 'Secure credential read failed.');
    }
    // Absence contract across platforms:
    //   * iOS resolves null (Keychain errSecItemNotFound).
    //   * Android resolves null (missing SharedPreferences keys).
    //   * Windows cannot resolve null on `ReactPromise<std::string>`, so it
    //     resolves "" for a missing vault entry. Empty is therefore treated as
    //     absent here — a stored empty payload is meaningless (write() rejects
    //     empty tokens before reaching native).
    return !raw ? null : parseStoredTokens(raw);
  }

  async write(tokens: StoredTokens): Promise<void> {
    if (!tokens.refreshToken || !tokens.sessionId) {
      throw new SecureStorageError('write-failed', 'Secure credentials are incomplete.');
    }
    const payload: StoredTokenPayload = { version: PAYLOAD_VERSION, ...tokens };
    try {
      await this.clearLegacy();
      await this.module().write(JSON.stringify(payload));
    } catch (error) {
      throw mapNativeError(error, 'write-failed', 'Secure credential write failed.');
    }
  }

  async clear(): Promise<void> {
    try {
      await this.module().clear();
      await this.clearLegacy();
    } catch (error) {
      throw mapNativeError(error, 'delete-failed', 'Secure credential cleanup failed.');
    }
  }
}
