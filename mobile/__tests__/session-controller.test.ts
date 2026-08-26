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
      accessToken: 'access-1', refreshToken: 'refresh-1', accessTokenExpiresAt: '', sessionId: 's1', actor,
    }),
    refresh: jest.fn().mockResolvedValue({
      accessToken: 'access-2', refreshToken: 'refresh-2', accessTokenExpiresAt: '', sessionId: 's2',
    }),
    getMe: jest.fn().mockResolvedValue(actor),
    logout: jest.fn().mockResolvedValue(undefined),
  };
}

describe('SessionController', () => {
  it('stores the refresh token and signs out locally even if logout fails', async () => {
    const api = client();
    api.logout.mockRejectedValue(new Error('offline'));
    const store = new MemoryTokenStore();
    const session = new SessionController(api, store);

    await expect(session.signIn({ email: 'u@example.com', password: 'secret' })).resolves.toMatchObject({ status: 'signed-in' });
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

  it('shares one refresh request between concurrent callers', async () => {
    const api = client();
    api.refresh.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({
      accessToken: 'access-2', refreshToken: 'refresh-2', accessTokenExpiresAt: '', sessionId: 's2',
    }), 5)));
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'old-refresh', sessionId: 's1' });
    const session = new SessionController(api, store);

    await Promise.all([session.refreshAccessToken(), session.refreshAccessToken()]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });
});
