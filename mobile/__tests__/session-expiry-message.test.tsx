import React from 'react';
import { Text, Pressable } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SessionProvider, useSession, useSessionStatus, useSessionActions, useSessionData } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient, ApiClientError } from '../src/api/client';
import { OfflineQueue } from '../src/storage/offline-queue';
import { MemoryKvStore } from '../src/platform/kv-store';
import { SessionCancelledError } from '../src/auth/session-controller';

jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), ApiClient: jest.fn() }));

/**
 * R4: a forced logout must say why. When the session is revoked or expires
 * mid-use (a 401 that survives refresh), the provider transitions to
 * 'signed-out' and SignInScreen renders. The reason must be visible there.
 */

function ExpiryProbe() {
  const { getReports } = useSessionActions();
  const { loadDashboard } = useSessionData();
  const { status, error } = useSessionStatus();
  return (
    <>
      <Text testID="status">{status}</Text>
      <Text testID="error">{error ?? ''}</Text>
      <Pressable
        testID="trigger-401"
        onPress={async () => {
          try {
            await getReports();
          } catch {
            // the UI consequence is what this test observes
          }
        }}
      />
      <Pressable
        testID="trigger-dashboard-401"
        onPress={async () => {
          try {
            await loadDashboard(true);
          } catch {
            // the UI consequence is what this test observes
          }
        }}
      />
    </>
  );
}

// useSession is the merged context; useSessionActions exposes getReports.
function useSessionProbe() {
  return null;
}
void useSessionProbe;
void useSession;

describe('forced logout carries a reason (R4)', () => {
  it('a 401 during loadDashboard also signs out with a visible reason', async () => {
    const expired = Object.assign(new ApiClientError(401, {
      data: null,
      error: { code: 'UNAUTHORIZED', message: 'Token expired' },
    }), { status: 401, message: 'Token expired' });
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({
          apiVersion: 1, appVersion: '1', backend: 'native',
          capabilities: { bearerAuth: true, mobileApi: true },
        }),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'a1', refreshToken: 'r1', accessTokenExpiresAt: '', sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1', email: 'u@x.com', role: 'user', permissionRole: 'user', hierarchyRole: 'user', isActive: true,
        }),
        getDashboard: jest.fn().mockRejectedValue(expired),
        getReference: jest.fn().mockResolvedValue({ projects: [], activityTypes: [] }),
        logout: jest.fn().mockResolvedValue(undefined),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer = undefined as never;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <ExpiryProbe />
        </SessionProvider>
      );
    });
    const trigger = renderer.root.findByProps({ testID: 'trigger-dashboard-401' });
    await ReactTestRenderer.act(async () => {
      await trigger.props.onPress();
    });

    const status = renderer.root.findByProps({ testID: 'status' });
    expect(status.props.children).toBe('signed-out');
    const errorNode = renderer.root.findByProps({ testID: 'error' });
    const shown = String(errorNode.props.children ?? '');
    expect(shown).toContain('session has expired');
  });

  it('a 401 during an authenticated call surfaces an expiry reason to the signed-out UI', async () => {
    // jest.auto-mock hollows the ApiClientError class, so build the error with
    // the mocked constructor and restore the fields the provider reads.
    const expired = Object.assign(new ApiClientError(401, {
      data: null,
      error: { code: 'UNAUTHORIZED', message: 'Token expired' },
    }), { status: 401, message: 'Token expired' });
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({
          apiVersion: 1, appVersion: '1', backend: 'native',
          capabilities: { bearerAuth: true, mobileApi: true },
        }),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'a1', refreshToken: 'r1', accessTokenExpiresAt: '', sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1', email: 'u@x.com', role: 'user', permissionRole: 'user', hierarchyRole: 'user', isActive: true,
        }),
        getReports: jest.fn().mockRejectedValue(expired),
        logout: jest.fn().mockResolvedValue(undefined),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer = undefined as never;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <ExpiryProbe />
        </SessionProvider>
      );
    });

    const trigger = renderer.root.findByProps({ testID: 'trigger-401' });
    await ReactTestRenderer.act(async () => {
      await trigger.props.onPress();
    });

    const status = renderer.root.findByProps({ testID: 'status' });
    expect(status.props.children).toBe('signed-out');

    const errorNode = renderer.root.findByProps({ testID: 'error' });
    const shown = String(errorNode.props.children ?? '');
    expect(shown.toLowerCase()).toContain('sign');
    expect(shown.length).toBeGreaterThan(0);
  });
});


describe('manual-review replay session boundary', () => {
  const serverUrl = 'https://timesheet.example.com';
  const actor = { id: 'u1', email: 'u@x.com', role: 'user', permissionRole: 'user', hierarchyRole: 'user', isActive: true };
  let session: ReturnType<typeof useSession>;
  let renderer: ReactTestRenderer.ReactTestRenderer;
  function Probe() { session = useSession(); return null; }

  async function setup(createLeave: jest.Mock) {
    const kv = new MemoryKvStore();
    const queue = new OfflineQueue(kv);
    await kv.setItem(`vsis_offline_queue_${serverUrl}_u1`, JSON.stringify({ version: 2, tickets: {}, items: [{
      id: 'mut_review', type: 'create_leave', payload: { input: { leaveDate: '2026-10-01', reason: 'Retained' } },
      createdAt: new Date().toISOString(), origin: serverUrl, retryCount: 0, status: 'manual_review', commitState: 'uncertain',
    }] }));
    const logout = jest.fn().mockResolvedValue(undefined);
    const getDashboard = jest.fn().mockResolvedValue({ actor, today: { date: '2026-10-01', hours: 0 }, week: { hours: 0 }, recentEntries: [] });
    (ApiClient as jest.Mock).mockImplementation(() => ({
      baseUrl: serverUrl,
      getConfig: jest.fn().mockResolvedValue({ apiVersion: 1, capabilities: { bearerAuth: true, mobileApi: true, durableIdempotency: true } }),
      refresh: jest.fn().mockResolvedValue({ accessToken: 'a1', refreshToken: 'r1', sessionId: 's1' }),
      login: jest.fn().mockResolvedValue({ accessToken: 'a2', refreshToken: 'r2', sessionId: 's2', actor: { ...actor, id: 'u2' } }),
      getMe: jest.fn().mockResolvedValue(actor), createLeave, getDashboard, logout,
    }));
    const tokens = new MemoryTokenStore();
    await tokens.write({ refreshToken: 'r1', sessionId: 's1' });
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<SessionProvider initialServerUrl={serverUrl} tokenStore={tokens} queue={queue}><Probe /></SessionProvider>);
    });
    return { queue, tokens, logout, getDashboard };
  }

  afterEach(async () => {
    await ReactTestRenderer.act(async () => renderer?.unmount());
  });

  it('signs out visibly after terminal 401 and retains the queued request', async () => {
    const expired = new ApiClientError(401, { data: null, error: { code: 'UNAUTHORIZED', message: 'Session revoked' } });
    const createLeave = jest.fn().mockRejectedValue(expired);
    const { queue, tokens, getDashboard } = await setup(createLeave);
    await ReactTestRenderer.act(async () => {
      await expect(session.resolveMutation('mut_review')).rejects.toBe(expired);
    });
    expect(session.status).toBe('signed-out');
    expect(session.error).toContain('session has expired or was revoked');
    expect(await tokens.read()).toBeNull();
    expect(await queue.list(serverUrl, 'u1')).toMatchObject([{ id: 'mut_review', status: 'manual_review', commitState: 'uncertain' }]);
    expect(getDashboard).not.toHaveBeenCalled();
  });

  it('dequeues a successful recent replay and refreshes the current dashboard/summary', async () => {
    const createLeave = jest.fn().mockResolvedValue({ success: true });
    const { queue, getDashboard } = await setup(createLeave);
    await ReactTestRenderer.act(async () => session.resolveMutation('mut_review'));
    expect(session.status).toBe('signed-in');
    expect(session.failedItems).toHaveLength(0);
    expect(await queue.size(serverUrl, 'u1')).toBe(0);
    expect(getDashboard).toHaveBeenCalledTimes(1);
  });

  it.each(['success', '401'])('cancels stale %s completion after a new account signs in', async outcome => {
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const createLeave = jest.fn(() => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; }));
    const { queue, tokens, logout, getDashboard } = await setup(createLeave);
    const summary = jest.spyOn(queue, 'getQueueSummary');
    let pending!: Promise<unknown>;
    await ReactTestRenderer.act(async () => {
      pending = session.resolveMutation('mut_review').catch(error => error);
      for (let attempt = 0; attempt < 30 && !createLeave.mock.calls.length; attempt++) await Promise.resolve();
    });
    expect(createLeave).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => session.signOut());
    await ReactTestRenderer.act(async () => session.signIn({ email: 'other@x.com', password: 'secret' }));
    summary.mockClear();
    const logoutCalls = logout.mock.calls.length;
    await ReactTestRenderer.act(async () => {
      if (outcome === 'success') finish();
      else fail(new ApiClientError(401, { data: null, error: { code: 'UNAUTHORIZED', message: 'Old session' } }));
      expect(await pending).toBeInstanceOf(SessionCancelledError);
    });
    expect(session.status).toBe('signed-in');
    expect(session.actor?.id).toBe('u2');
    expect(session.error).toBeNull();
    expect(await tokens.read()).toMatchObject({ sessionId: 's2' });
    expect(logout).toHaveBeenCalledTimes(logoutCalls);
    expect(getDashboard).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
    if (outcome === '401') expect(await queue.size(serverUrl, 'u1')).toBe(1);
  });
});
