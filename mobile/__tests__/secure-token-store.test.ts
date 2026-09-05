import { createTokenStore, NativeTokenStore, SecureStorageError } from '../src/platform/secure-storage';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { WorkspaceStore } from '../src/storage/workspace-store';

describe('SecureTokenStore & WorkspaceStore', () => {
  it('writes, reads, and clears stored tokens in MemoryTokenStore', async () => {
    const store = new MemoryTokenStore();
    expect(await store.read()).toBeNull();

    await store.write({ refreshToken: 'ref-123', sessionId: 'sess-abc' });
    expect(await store.read()).toEqual({ refreshToken: 'ref-123', sessionId: 'sess-abc' });

    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it('round-trips versioned payloads through the native adapter', async () => {
    let payload: string | null = null;
    const native = {
      read: async () => payload,
      write: async (next: string) => {
        payload = next;
      },
      clear: async () => {
        payload = null;
      },
      clearLegacy: async () => undefined,
    };
    const store = new NativeTokenStore(native);

    expect(await store.read()).toBeNull();

    await store.write({ refreshToken: 'ref-native', sessionId: 'sess-native' });
    expect(JSON.parse(payload ?? '')).toEqual({
      version: 1,
      refreshToken: 'ref-native',
      sessionId: 'sess-native',
    });
    expect(await store.read()).toEqual({ refreshToken: 'ref-native', sessionId: 'sess-native' });

    await store.write({ refreshToken: 'ref-overwritten', sessionId: 'sess-overwritten' });
    expect(await store.read()).toEqual({
      refreshToken: 'ref-overwritten',
      sessionId: 'sess-overwritten',
    });
    expect(payload).not.toContain('accessToken');

    const restartedStore = new NativeTokenStore(native);
    await expect(restartedStore.read()).resolves.toEqual({
      refreshToken: 'ref-overwritten',
      sessionId: 'sess-overwritten',
    });

    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it('fails closed when the native secure-storage module is unavailable', async () => {
    const store = createTokenStore();
    await expect(store.read()).rejects.toMatchObject<Partial<SecureStorageError>>({ code: 'unavailable' });
  });

  it('rejects corrupt native payloads without exposing its contents', async () => {
    const store = new NativeTokenStore({
      read: async () => '{"refreshToken":"secret"}',
      write: async () => undefined,
      clear: async () => undefined,
      clearLegacy: async () => undefined,
    });

    await expect(store.read()).rejects.toMatchObject({ code: 'corrupt' });
    await expect(store.read()).rejects.not.toThrow('secret');
  });

  it('maps native locked errors to the stable storage contract', async () => {
    const store = new NativeTokenStore({
      read: async () => {
        throw { code: 'locked', message: 'credential contents must not escape' };
      },
      write: async () => undefined,
      clear: async () => undefined,
      clearLegacy: async () => undefined,
    });

    await expect(store.read()).rejects.toMatchObject({ code: 'locked' });
    await expect(store.read()).rejects.not.toThrow('credential contents');
  });

  it('persists and clears workspace URL in WorkspaceStore', async () => {
    const store = new WorkspaceStore();
    await store.clear();
    expect(await store.get()).toBeNull();

    await store.set('https://timesheet.example.com');
    expect(await store.get()).toBe('https://timesheet.example.com');

    await store.clear();
    expect(await store.get()).toBeNull();
  });

  it('persists workspace URL via NativeModules.VsisSecureStorage when available', async () => {
    const { NativeModules } = require('react-native');
    let nativeUrl: string | null = null;
    NativeModules.VsisSecureStorage = {
      readWorkspace: jest.fn(async () => nativeUrl),
      writeWorkspace: jest.fn(async (url: string) => {
        nativeUrl = url;
      }),
      clearWorkspace: jest.fn(async () => {
        nativeUrl = null;
      }),
    };

    try {
      const store1 = new WorkspaceStore();
      await store1.set('https://persisted-native.example.com');
      expect(NativeModules.VsisSecureStorage.writeWorkspace).toHaveBeenCalledWith('https://persisted-native.example.com');
      expect(nativeUrl).toBe('https://persisted-native.example.com');

      // Simulate app restart with a fresh WorkspaceStore instance
      const store2 = new WorkspaceStore();
      const loaded = await store2.get();
      expect(NativeModules.VsisSecureStorage.readWorkspace).toHaveBeenCalled();
      expect(loaded).toBe('https://persisted-native.example.com');

      // Disconnect
      await store2.clear();
      expect(NativeModules.VsisSecureStorage.writeWorkspace).toHaveBeenCalledWith('__DISCONNECTED__');
      const store3 = new WorkspaceStore();
      expect(await store3.get()).toBeNull();

      // Reset
      await store3.reset();
      expect(NativeModules.VsisSecureStorage.clearWorkspace).toHaveBeenCalled();
    } finally {
      delete NativeModules.VsisSecureStorage;
    }
  });
});

