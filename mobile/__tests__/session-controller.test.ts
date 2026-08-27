import { SessionController } from '../src/auth/session-controller';
import { MemoryTokenStore } from '../src/auth/token-store';
import { ApiClientError } from '../src/api/client';

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
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: '',
      sessionId: 's1',
      actor,
    }),
    refresh: jest.fn().mockResolvedValue({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      accessTokenExpiresAt: '',
      sessionId: 's2',
    }),
    getMe: jest.fn().mockResolvedValue(actor),
    logout: jest.fn().mockResolvedValue(undefined),
    logoutAll: jest.fn().mockResolvedValue(undefined),
  };
}

describe('SessionController', () => {
  it('stores the refresh token and signs out locally even if logout fails', async () => {
    const api = client();
    api.logout.mockRejectedValue(new Error('offline'));
    const store = new MemoryTokenStore();
    const session = new SessionController(api, store);

    await expect(session.signIn({ email: 'u@example.com', password: 'secret' })).resolves.toMatchObject({
      status: 'signed-in',
    });
    await session.signOut();

    await expect(store.read()).resolves.toBeNull();
    expect(session.getState()).toEqual({ status: 'signed-out' });
  });

  it('restores a session through refresh and fetches the current actor', async () => {
    const api = client();
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'old-refresh', sessionId: 's1' });
    const session = new SessionController(api, store);

    await expect(session.restore()).resolves.toMatchObject({ status: 'signed-in', accessToken: 'access-2' });
    expect(api.refresh).toHaveBeenCalledWith('old-refresh');
    expect(api.getMe).toHaveBeenCalledWith('access-2');
    await expect(store.read()).resolves.toEqual({ refreshToken: 'refresh-2', sessionId: 's2' });
  });

  it('clears token store when server explicitly rejects refresh token with 401', async () => {
    const api = client();
    api.refresh.mockRejectedValue(
      new ApiClientError(401, { data: null, error: { code: 'INVALID_REFRESH_TOKEN', message: 'invalid' } })
    );
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'expired-refresh', sessionId: 's1' });
    const session = new SessionController(api, store);

    await expect(session.restore()).resolves.toEqual({ status: 'signed-out' });
    await expect(store.read()).resolves.toBeNull();
  });

  it('preserves stored token and enters offline status on network outage during restore', async () => {
    const api = client();
    api.refresh.mockRejectedValue(new TypeError('Network request failed'));
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'saved-refresh', sessionId: 's1' });
    const session = new SessionController(api, store);

    const result = await session.restore();
    expect(result).toMatchObject({ status: 'offline', tokens: { refreshToken: 'saved-refresh', sessionId: 's1' } });
    await expect(store.read()).resolves.toEqual({ refreshToken: 'saved-refresh', sessionId: 's1' });
  });

  it('shares one refresh request between concurrent callers', async () => {
    const api = client();
    api.refresh.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                accessToken: 'access-2',
                refreshToken: 'refresh-2',
                accessTokenExpiresAt: '',
                sessionId: 's2',
              }),
            5
          )
        )
    );
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'old-refresh', sessionId: 's1' });
    const session = new SessionController(api, store);

    await Promise.all([session.refreshAccessToken(), session.refreshAccessToken()]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it('rolls back server session if token storage write fails during sign-in', async () => {
    const api = {
      ...client(),
      logoutAll: jest.fn().mockResolvedValue(undefined),
    };
    const brokenStore = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockRejectedValue(new Error('Keystore locked')),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    const session = new SessionController(api, brokenStore);

    const result = await session.signIn({ email: 'u@example.com', password: 'secret' });
    expect(result.status).toBe('error');
    expect(api.logout).toHaveBeenCalledWith('access-1');
  });

  it('calls client.logoutAll and clears storage on logoutAll', async () => {
    const api = {
      ...client(),
      logoutAll: jest.fn().mockResolvedValue(undefined),
    };
    const store = new MemoryTokenStore();
    const session = new SessionController(api, store);

    await session.signIn({ email: 'u@example.com', password: 'secret' });
    await session.logoutAll();

    expect(api.logoutAll).toHaveBeenCalledWith('access-1');
    await expect(store.read()).resolves.toBeNull();
    expect(session.getState()).toEqual({ status: 'signed-out' });
  });

  it('transitions from pending-approval to signed-in when checkStatus discovers active status', async () => {
    const inactiveActor = { ...actor, isActive: false };
    const activeActor = { ...actor, isActive: true };
    const api = client();
    api.login.mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: '',
      sessionId: 's1',
      actor: inactiveActor,
    });
    api.getMe.mockResolvedValue(activeActor);

    const store = new MemoryTokenStore();
    const session = new SessionController(api, store);

    const signinResult = await session.signIn({ email: 'u@example.com', password: 'secret' });
    expect(signinResult.status).toBe('pending-approval');

    const checkResult = await session.checkStatus();
    expect(checkResult.status).toBe('signed-in');
    expect(checkResult).toMatchObject({
      status: 'signed-in',
      actor: activeActor,
      accessToken: 'access-1',
    });
    expect(api.getMe).toHaveBeenCalledWith('access-1');
  });

  it('maintains pending-approval state when checkStatus confirms user is still inactive', async () => {
    const inactiveActor = { ...actor, isActive: false };
    const api = client();
    api.login.mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: '',
      sessionId: 's1',
      actor: inactiveActor,
    });
    api.getMe.mockResolvedValue(inactiveActor);

    const store = new MemoryTokenStore();
    const session = new SessionController(api, store);

    await session.signIn({ email: 'u@example.com', password: 'secret' });
    const checkResult = await session.checkStatus();
    expect(checkResult.status).toBe('pending-approval');
    expect(session.getState().status).toBe('pending-approval');
  });
});
