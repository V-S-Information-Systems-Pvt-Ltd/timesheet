import { SessionController, SessionLifecycle, SessionCancelledError } from '../src/auth/session-controller';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function untilCalled(mock: jest.Mock) {
  for (let attempt = 0; attempt < 20 && !mock.mock.calls.length; attempt++) await Promise.resolve();
  expect(mock).toHaveBeenCalled();
}

function expectCancelled(promise: Promise<unknown>) {
  return promise.then(
    () => { throw new Error('Expected session cancellation.'); },
    error => { expect(error).toBeInstanceOf(SessionCancelledError); }
  );
}

describe('SessionController lifecycle ownership', () => {
  const pair = { accessToken: 'late-access', refreshToken: 'late-refresh', sessionId: 'late-session', accessTokenExpiresAt: '' };

  it.each(['signOut', 'logoutAll'] as const)('does not restore credentials after %s supersedes a pending refresh', async (operation) => {
    const api = client();
    const response = deferred<typeof pair>();
    api.refresh.mockReturnValue(response.promise);
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'old', sessionId: 's1' });
    const session = new SessionController(api, store);
    const pending = session.refreshAccessToken();
    const rejected = expectCancelled(pending);
    await untilCalled(api.refresh);
    await session[operation]();
    response.resolve(pair);
    await rejected;
    expect(await store.read()).toBeNull();
    expect(session.getState()).toEqual({ status: 'signed-out' });
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it('a late refresh failure cannot change the state or credentials of a new login', async () => {
    const api = client();
    const response = deferred<typeof pair>();
    api.refresh.mockReturnValue(response.promise);
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'old', sessionId: 's1' });
    const session = new SessionController(api, store);
    const pending = session.refreshAccessToken();
    const rejected = expectCancelled(pending);
    await untilCalled(api.refresh);
    await session.signIn({ email: 'new@example.com', password: 'secret' });
    response.reject(new Error('late network failure'));
    await rejected;
    expect(session.getState()).toMatchObject({ status: 'signed-in', accessToken: 'access-1' });
    expect(await store.read()).toEqual({ refreshToken: 'refresh-1', sessionId: 's1' });
  });

  it('shares storage ordering across controllers and clears an already executing obsolete write', async () => {
    const tokens = new MemoryTokenStore();
    await tokens.write({ refreshToken: 'old', sessionId: 's1' });
    const writing = deferred<void>();
    const store = {
      read: () => tokens.read(), clear: jest.fn(() => tokens.clear()),
      write: jest.fn(async (value: { refreshToken: string; sessionId: string }) => {
        await writing.promise;
        await tokens.write(value);
      }),
    };
    const lifecycle = new SessionLifecycle();
    const old = new SessionController(client(), store, lifecycle);
    const successor = new SessionController(client(), store, lifecycle);
    const refresh = old.refreshAccessToken();
    const rejected = expectCancelled(refresh);
    await untilCalled(store.write);
    const logout = successor.signOut();
    expect(store.clear).not.toHaveBeenCalled();
    writing.resolve();
    await Promise.all([rejected, logout]);
    expect(await tokens.read()).toBeNull();
  });

  it('does not run stale failed-write cleanup against a successor login', async () => {
    const tokens = new MemoryTokenStore();
    await tokens.write({ refreshToken: 'old', sessionId: 's1' });
    const writing = deferred<void>();
    const store = {
      read: () => tokens.read(), clear: jest.fn(() => tokens.clear()),
      write: jest.fn().mockImplementationOnce(() => writing.promise).mockImplementation((value) => tokens.write(value)),
    };
    const lifecycle = new SessionLifecycle();
    const old = new SessionController(client(), store, lifecycle);
    const successor = new SessionController(client(), store, lifecycle);
    const refresh = old.refreshAccessToken();
    const rejected = expectCancelled(refresh);
    await untilCalled(store.write);
    const login = successor.signIn({ email: 'new@example.com', password: 'secret' });
    writing.reject(new Error('late storage failure'));
    await Promise.all([rejected, login]);
    expect(store.clear).not.toHaveBeenCalled();
    expect(await tokens.read()).toEqual({ refreshToken: 'refresh-1', sessionId: 's1' });
  });

  it('does not publish a pending actor status check after logout', async () => {
    const api = client();
    const session = new SessionController(api, new MemoryTokenStore());
    await session.signIn({ email: 'u@example.com', password: 'secret' });
    const response = deferred<typeof actor>();
    api.getMe.mockReturnValue(response.promise);
    const check = session.checkStatus();
    const rejected = expectCancelled(check);
    await session.signOut();
    response.resolve(actor);
    await rejected;
    expect(session.getState()).toEqual({ status: 'signed-out' });
  });

  it('does not wait for remote logout before clearing local credentials', async () => {
    const api = client();
    api.logout.mockReturnValue(new Promise(() => {}));
    const store = new MemoryTokenStore();
    const session = new SessionController(api, store);
    await session.signIn({ email: 'u@example.com', password: 'secret' });
    await session.signOut();
    expect(await store.read()).toBeNull();
    expect(api.logout).toHaveBeenCalledWith('access-1');
  });

  it('an obsolete refresh finalizer preserves the new generation single-flight', async () => {
    const api = client();
    const old = deferred<typeof pair>();
    const fresh = deferred<typeof pair>();
    api.refresh.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'old', sessionId: 's1' });
    const session = new SessionController(api, store);
    const pending = session.refreshAccessToken();
    const rejected = expectCancelled(pending);
    await untilCalled(api.refresh);
    await session.signIn({ email: 'u@example.com', password: 'secret' });
    const current = session.refreshAccessToken();
    old.resolve(pair);
    await rejected;
    const shared = session.refreshAccessToken();
    fresh.resolve(pair);
    expect(await current).toBe('late-access');
    expect(await shared).toBe('late-access');
    expect(api.refresh).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown and old-generation request tokens before secure-store reads', async () => {
    const api = client();
    const store = new MemoryTokenStore();
    const read = jest.spyOn(store, 'read');
    const session = new SessionController(api, store);
    await session.signIn({ email: 'u@example.com', password: 'secret' });
    const oldGeneration = session.lifecycle.current();
    await expect(session.refreshForRequest('unknown', oldGeneration)).rejects.toBeInstanceOf(SessionCancelledError);
    await session.signIn({ email: 'u@example.com', password: 'secret' });
    await expect(session.refreshForRequest('access-1', oldGeneration)).rejects.toBeInstanceOf(SessionCancelledError);
    expect(read).not.toHaveBeenCalled();
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it.each(['restore', 'signIn'] as const)('a pending %s cannot overwrite logout', async (operation) => {
    const api = client();
    const response = deferred<typeof pair & { actor: typeof actor }>();
    if (operation === 'restore') api.refresh.mockReturnValue(response.promise);
    else api.login.mockReturnValue(response.promise);
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'old', sessionId: 's1' });
    const session = new SessionController(api, store);
    const pending = operation === 'restore' ? session.restore() : session.signIn({ email: 'u@example.com', password: 'secret' });
    const result = pending.catch(error => error);
    await untilCalled(operation === 'restore' ? api.refresh : api.login);
    await session.signOut();
    response.resolve({ ...pair, actor });
    expect(await result).toBeInstanceOf(SessionCancelledError);
    expect(await store.read()).toBeNull();
    expect(session.getState()).toEqual({ status: 'signed-out' });
    if (operation === 'signIn') expect(api.logout).toHaveBeenCalledWith('late-access');
  });

  it('reports a late status failure as cancellation rather than a current authorization failure', async () => {
    const api = client();
    const session = new SessionController(api, new MemoryTokenStore());
    await session.signIn({ email: 'u@example.com', password: 'secret' });
    const response = deferred<typeof actor>();
    api.getMe.mockReturnValue(response.promise);
    const checking = session.checkStatus().catch(error => error);
    await session.signOut();
    response.reject(new ApiClientError(401, { data: null, error: { code: 'UNAUTHORIZED', message: 'old' } }));
    expect(await checking).toBeInstanceOf(SessionCancelledError);
    expect(session.getState()).toEqual({ status: 'signed-out' });
  });

  it('applies a pending status actor result without overwriting a completed same-generation refresh token pair', async () => {
    const api = client();
    const store = new MemoryTokenStore();
    const session = new SessionController(api, store);
    await session.signIn({ email: actor.email, password: 'secret' });
    const status = deferred<typeof actor>();
    api.getMe.mockReturnValueOnce(status.promise).mockResolvedValue(actor);
    const checking = session.checkStatus();
    await session.refreshAccessToken();
    status.resolve({ ...actor, isActive: false });
    expect(await checking).toMatchObject({
      status: 'pending-approval', actor: { isActive: false }, accessToken: 'access-2',
      tokens: { refreshToken: 'refresh-2', sessionId: 's2' },
    });
    expect(await store.read()).toEqual({ refreshToken: 'refresh-2', sessionId: 's2' });
  });

  it('a pending status success cannot restore signed-in state after a same-generation refresh persistence failure', async () => {
    const api = client();
    const store = new MemoryTokenStore();
    const session = new SessionController(api, store);
    await session.signIn({ email: actor.email, password: 'secret' });
    const status = deferred<typeof actor>();
    api.getMe.mockReturnValueOnce(status.promise);
    const checking = session.checkStatus();
    jest.spyOn(store, 'write').mockRejectedValueOnce(new Error('locked'));
    await expect(session.refreshAccessToken()).rejects.toThrow('Secure credential persistence failed.');
    status.resolve(actor);
    expect(await checking).toEqual({ status: 'error', message: 'Secure credential persistence failed.' });
    expect(await store.read()).toBeNull();
  });

  it('reuses the latest accepted token for a late same-generation 401 and supports a current no-argument caller', async () => {
    const api = client();
    const session = new SessionController(api, new MemoryTokenStore());
    await expect(session.refreshForRequest(undefined, session.lifecycle.current())).rejects.toBeInstanceOf(SessionCancelledError);
    await session.signIn({ email: 'u@example.com', password: 'secret' });
    const generation = session.lifecycle.current();
    expect(await session.refreshForRequest(undefined, generation)).toBe('access-2');
    expect(await session.refreshForRequest('access-1', generation)).toBe('access-2');
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });
});

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
    expect(result).toEqual({ status: 'error', message: 'Secure credential persistence failed.' });
    expect(api.logout).toHaveBeenCalledWith('access-1');
  });

  it('does not turn a secure-storage read failure into signed-out', async () => {
    const api = client();
    const brokenStore = {
      read: jest.fn().mockRejectedValue(new Error('Keystore locked: secret material unavailable')),
      write: jest.fn(),
      clear: jest.fn(),
    };
    const session = new SessionController(api, brokenStore);

    await expect(session.restore()).resolves.toEqual({
      status: 'error',
      message: 'Secure credential read failed.',
    });
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('surfaces cleanup failure after a revoked refresh token', async () => {
    const api = client();
    api.refresh.mockRejectedValue(new ApiClientError(401, { data: null, error: { code: 'INVALID_REFRESH_TOKEN', message: 'invalid' } }));
    const store = {
      read: jest.fn().mockResolvedValue({ refreshToken: 'expired-refresh', sessionId: 's1' }),
      write: jest.fn(),
      clear: jest.fn().mockRejectedValue(new Error('locked')),
    };
    const session = new SessionController(api, store);

    await expect(session.restore()).resolves.toEqual({
      status: 'error',
      message: 'Secure credential cleanup failed.',
    });
  });

  it('clears local credentials and enters an error state when refresh rotation cannot persist', async () => {
    const api = client();
    const store = {
      read: jest.fn().mockResolvedValue({ refreshToken: 'old-refresh', sessionId: 's1' }),
      write: jest.fn().mockRejectedValue(new Error('locked')),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    const session = new SessionController(api, store);

    await expect(session.refreshAccessToken()).rejects.toThrow('Secure credential persistence failed.');
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(session.getState()).toEqual({ status: 'error', message: 'Secure credential persistence failed.' });
  });

  it('does not claim signed-out when logout cleanup fails', async () => {
    const api = client();
    const store = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockRejectedValue(new Error('locked')),
    };
    const session = new SessionController(api, store);

    await session.signOut();

    expect(session.getState()).toEqual({ status: 'error', message: 'Secure credential cleanup failed.' });
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
