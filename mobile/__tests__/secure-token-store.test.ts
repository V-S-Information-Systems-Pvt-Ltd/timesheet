import { createTokenStore, MemoryTokenStore } from '../src/platform/secure-storage';

describe('SecureTokenStore', () => {
  it('writes, reads, and clears stored tokens', async () => {
    const store = new MemoryTokenStore();
    expect(await store.read()).toBeNull();

    await store.write({ refreshToken: 'ref-123', sessionId: 'sess-abc' });
    expect(await store.read()).toEqual({ refreshToken: 'ref-123', sessionId: 'sess-abc' });

    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it('creates default token store factory instance', () => {
    const store = createTokenStore();
    expect(store).toBeDefined();
    expect(typeof store.read).toBe('function');
    expect(typeof store.write).toBe('function');
    expect(typeof store.clear).toBe('function');
  });
});
