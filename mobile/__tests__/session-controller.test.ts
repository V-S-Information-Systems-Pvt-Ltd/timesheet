import { SessionController } from '../src/auth/session-controller';
import { MemoryTokenStore } from '../src/auth/token-store';

const actor = {
  id: 'u1',
  email: 'u@example.com',
  role: 'user',
  permissionRole: 'user',
  hierarchyRole: 'user',
  isActive: true,
};

function client() {
  return {
    login: jest.fn().mockResolvedValue({
      accessToken: 'access-1', refreshToken: 'refresh-1', accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), sessionId: 's1', actor,
    }),
    refresh: jest.fn().mockResolvedValue({
      accessToken: 'access-2', refreshToken: 'refresh-2', accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), sessionId: 's2',
    }),
    getMe: jest.fn().mockResolvedValue(actor),
    logout: jest.fn().mockResolvedValue(undefined),
    logoutAll: jest.fn().mockResolvedValue(undefined),
  };
}

function networkError() {
  const error = new Error('offline');
  (error as Error & { code?: string }).code = 'NETWORK_ERROR';
  return error;
}

describe('SessionController', () => {
  it('stores the refresh token before completing sign-in and signs out locally even if logout fails', async () => {
    const api = client();
    api.logout.mockRejectedValue(new Error('offline'));
    const store = new MemoryTokenStore();
    const session = new SessionController(api, store);

    await session.signIn({ email: 'u@example.com', password: 'secret' });
    await expect(store.read()).resolves.toMatchObject({ refreshToken: 'refresh-1', sessionId: 's1' });

    await session.signOut();

    await expect(store.read()).resolves.toBeNull();
    expect(session.getState()).toEqual({ status: 'signed-out', baseUrl: null });
  });

  it('persists the approved base URL with the session tokens', async () => {
    const api = client();
    api.refresh.mockResolvedValue({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      sessionId: 's2',
    });
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'old-refresh', sessionId: 's1', baseUrl: 'https://vsis.example' });
    const session = new SessionController(api, store);

    await expect(session.restore()).resolves.toMatchObject({
      status: 'signed-in',
      baseUrl: 'https://vsis.example',
    });
    await expect(store.read()).resolves.toMatchObject({
      refreshToken: 'refresh-2',
      sessionId: 's2',
      baseUrl: 'https://vsis.example',
    });
  });

  it('restores a session through refresh and fetches the current actor', async () => {
    const api = client();
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'old-refresh', sessionId: 's1' });
    const session = new SessionController(api, store);

    await expect(session.restore()).resolves.toMatchObject({ status: 'signed-in', accessToken: 'access-2' });
    expect(api.refresh).toHaveBeenCalledWith('old-refresh');
    expect(api.getMe).toHaveBeenCalledWith();
    await expect(store.read()).resolves.toEqual({ refreshToken: 'refresh-2', sessionId: 's2' });
  });

  it('keeps the stored token and reports offline when the server is unreachable on cold start', async () => {
    const api = client();
    api.refresh.mockRejectedValue(networkError());
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'old-refresh', sessionId: 's1', baseUrl: 'https://vsis.example' });
    const session = new SessionController(api, store);

    await expect(session.restore()).resolves.toMatchObject({
      status: 'offline',
      baseUrl: 'https://vsis.example',
    });
    // The refresh token must survive so a later retry can recover.
    await expect(store.read()).resolves.toMatchObject({ refreshToken: 'old-refresh' });
  });

  it('clears local secrets when the refresh token is invalid or reused', async () => {
    const api = client();
    api.refresh.mockRejectedValue(new Error('invalid'));
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'reused', sessionId: 's1' });
    const session = new SessionController(api, store);

    await expect(session.restore()).resolves.toMatchObject({ status: 'signed-out' });
    await expect(store.read()).resolves.toBeNull();
  });

  it('shares one refresh request between concurrent callers', async () => {
    const api = client();
    api.refresh.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({
      accessToken: 'access-2', refreshToken: 'refresh-2', accessTokenExpiresAt: '', sessionId: 's2',
    }), 5)));
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'old-refresh', sessionId: 's1' });
    const session = new SessionController(api, store);
    await session.restore();

    await Promise.all([session.refreshAccessToken(), session.refreshAccessToken()]);
    expect(api.refresh).toHaveBeenCalledTimes(2); // one cold-start + one shared
  });

  it('revokes a fresh server session when secure storage cannot persist it', async () => {
    const api = client();
    const failingStore = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockRejectedValue(new Error('keychain locked')),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    const session = new SessionController(api, failingStore);

    await expect(session.signIn({ email: 'u@example.com', password: 'secret' })).rejects.toThrow('keychain locked');
    expect(api.logout).toHaveBeenCalled();
    expect(failingStore.clear).toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ status: 'signed-out' });
  });

  it('signs out of every device through logout-all', async () => {
    const api = client();
    const store = new MemoryTokenStore();
    const session = new SessionController(api, store);
    await session.signIn({ email: 'u@example.com', password: 'secret' });

    await session.signOutAllDevices();

    expect(api.logoutAll).toHaveBeenCalled();
    await expect(store.read()).resolves.toBeNull();
    expect(session.getState()).toEqual({ status: 'signed-out', baseUrl: null });
  });

  it('moves to pending-approval for inactive actors', async () => {
    const api = client();
    api.login.mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      sessionId: 's1',
      actor: { ...actor, isActive: false },
    });
    const store = new MemoryTokenStore();
    const session = new SessionController(api, store);

    await session.signIn({ email: 'u@example.com', password: 'secret' });
    expect(session.getState()).toMatchObject({ status: 'pending-approval' });
  });
});
