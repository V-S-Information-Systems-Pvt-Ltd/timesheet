import { createTokenStore, MemoryTokenStore, DurableTokenStore } from '../src/platform/secure-storage';
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

  it('writes, reads, and clears stored tokens in DurableTokenStore', async () => {
    const store = new DurableTokenStore();
    await store.clear();
    expect(await store.read()).toBeNull();

    await store.write({ refreshToken: 'ref-durable', sessionId: 'sess-durable' });
    expect(await store.read()).toEqual({ refreshToken: 'ref-durable', sessionId: 'sess-durable' });

    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it('creates default token store factory instance as durable', () => {
    const store = createTokenStore();
    expect(store).toBeInstanceOf(DurableTokenStore);
    expect(typeof store.read).toBe('function');
    expect(typeof store.write).toBe('function');
    expect(typeof store.clear).toBe('function');
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
});
