import { NativeModules } from 'react-native';

import {
  SecureStorageUnavailableError,
  createSecureTokenStore,
} from '../src/platform/secure-storage';

type SecureStorageModule = {
  set: jest.Mock;
  get: jest.Mock;
  remove: jest.Mock;
};

function installSecureStorage(): {
  module: SecureStorageModule;
  locker: Map<string, string>;
} {
  const locker = new Map<string, string>();
  const mod: SecureStorageModule = {
    set: jest.fn(async (_service: string, key: string, value: string) => {
      locker.set(key, value);
      return true;
    }),
    get: jest.fn(async (_service: string, _key: string) => locker.get(_key) ?? null),
    remove: jest.fn(async (_service: string, key: string) => locker.delete(key)),
  };
  (NativeModules as Record<string, unknown>).VsisSecureStorage = mod;
  return { module: mod, locker };
}

afterEach(() => {
  delete (NativeModules as Record<string, unknown>).VsisSecureStorage;
});

describe('secure token store platform adapters', () => {
  it('round-trips tokens through the native secure-storage contract', async () => {
    const { module, locker } = installSecureStorage();
    const store = createSecureTokenStore('windows');

    await store.write({ refreshToken: 'rt-1', sessionId: 's-1', baseUrl: 'https://vsis.example' });

    expect(module.set).toHaveBeenCalledWith('com.vsis.timesheet', 'mobile-refresh-token', expect.any(String));
    expect(locker.size).toBe(1);
    const raw = [...locker.values()][0];
    // Only one opaque JSON payload is stored; no raw tokens outside it.
    expect(raw).not.toContain('mobile-refresh-token');
    expect(JSON.parse(raw)).toMatchObject({ refreshToken: 'rt-1', sessionId: 's-1' });

    await expect(store.read()).resolves.toMatchObject({
      refreshToken: 'rt-1',
      sessionId: 's-1',
      baseUrl: 'https://vsis.example',
    });

    await store.clear();
    expect(module.remove).toHaveBeenCalled();
    await expect(store.read()).resolves.toBeNull();
  });

  it('drops unreadable payloads instead of failing every cold start', async () => {
    const { module, locker } = installSecureStorage();
    locker.set('mobile-refresh-token', '{not-json');
    const store = createSecureTokenStore('android');

    await expect(store.read()).resolves.toBeNull();
    // The corrupt entry was removed so the next write starts clean.
    expect(module.remove).toHaveBeenCalled();
    expect(locker.has('mobile-refresh-token')).toBe(false);
  });

  it('rejects writes that the OS-backed store could not persist', async () => {
    const { module } = installSecureStorage();
    module.set.mockResolvedValue(false);
    const store = createSecureTokenStore('ios');

    await expect(
      store.write({ refreshToken: 'rt-1', sessionId: 's-1' }),
    ).rejects.toThrow('Failed to persist the session securely.');
  });

  it('fails closed when no OS-backed store exists on the platform', () => {
    expect(() => createSecureTokenStore('windows')).toThrow(SecureStorageUnavailableError);
    expect(() => createSecureTokenStore('web')).toThrow(SecureStorageUnavailableError);
  });
});
