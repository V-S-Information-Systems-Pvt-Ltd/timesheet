import { SecureStorageError } from './secure-storage/types';

const LEGACY_LOCAL_STORAGE_KEY = 'vsis_timesheet_secure_tokens';

/**
 * Removes the pre-cutover browser credential entry without reading or
 * migrating its value. Native adapters remove their platform-specific legacy
 * file through the `clearLegacy` method.
 */
export async function clearLegacyBrowserCredential(): Promise<void> {
  try {
    const storage = (globalThis as typeof globalThis & {
      localStorage?: { removeItem(key: string): void };
    }).localStorage;
    storage?.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  } catch {
    throw new SecureStorageError('delete-failed', 'Legacy credential cleanup failed.');
  }
}
