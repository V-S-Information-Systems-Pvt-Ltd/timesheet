import React from 'react';
import { Text, Pressable } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SessionProvider, useSession, useSessionStatus, useSessionActions, useSessionData } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient, ApiClientError } from '../src/api/client';

jest.mock('../src/api/client');

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
