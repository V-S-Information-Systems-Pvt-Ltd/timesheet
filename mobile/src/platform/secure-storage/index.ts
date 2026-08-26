import { NativeModules, Platform } from 'react-native';

import {
  SecureStorageUnavailableError,
  type SecureTokenStore,
  type StoredTokens,
} from './types';

export { SecureStorageUnavailableError } from './types';
export type { SecureTokenStore, StoredTokens } from './types';

/**
 * Shared native contract implemented by `VsisSecureStorage` on every
 * platform:
 *
 * - Android: AES/GCM payload encrypted with a non-exportable key held in the
 *   Android Keystore; ciphertext lives in app-private storage.
 * - iOS: Keychain generic-password item, device-only accessibility.
 * - Windows: `Windows.Security.Credentials.PasswordVault` credential.
 *
 * Values are opaque strings (the adapters serialize the session JSON).
 */
interface SecureStorageNativeModule {
  set(service: string, key: string, value: string): Promise<boolean>;
  get(service: string, key: string): Promise<string | null>;
  remove(service: string, key: string): Promise<boolean>;
}

const SERVICE = 'com.vsis.timesheet';
const ACCOUNT = 'mobile-refresh-token';

function requireModule(label: string): SecureStorageNativeModule {
  const candidate = (NativeModules as Record<string, unknown>)[label];
  if (!candidate || typeof candidate !== 'object') {
    throw new SecureStorageUnavailableError(label);
  }
  return candidate as SecureStorageNativeModule;
}

class JsonCredentialStore implements SecureTokenStore {
  constructor(private readonly backend: SecureStorageNativeModule) {}

  async read(): Promise<StoredTokens | null> {
    const raw = await this.backend.get(SERVICE, ACCOUNT);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredTokens;
      if (
        !parsed ||
        typeof parsed.refreshToken !== 'string' ||
        typeof parsed.sessionId !== 'string'
      ) {
        throw new Error('Malformed stored session.');
      }
      return parsed;
    } catch {
      // Unreadable payload: drop it rather than failing every cold start.
      await this.backend.remove(SERVICE, ACCOUNT).catch(() => undefined);
      return null;
    }
  }

  async write(tokens: StoredTokens): Promise<void> {
    const written = await this.backend.set(SERVICE, ACCOUNT, JSON.stringify(tokens));
    if (!written) throw new Error('Failed to persist the session securely.');
  }

  async clear(): Promise<void> {
    await this.backend.remove(SERVICE, ACCOUNT);
  }
}

/**
 * Resolves the OS-backed store for the current platform or throws
 * {@link SecureStorageUnavailableError}. There is intentionally no in-memory
 * fallback: callers must surface the failure instead of degrading security.
 */
export function createSecureTokenStore(platform: string = Platform.OS): SecureTokenStore {
  switch (platform) {
    case 'android':
    case 'ios':
    case 'windows':
      return new JsonCredentialStore(requireModule('VsisSecureStorage'));
    default:
      throw new SecureStorageUnavailableError(platform);
  }
}
