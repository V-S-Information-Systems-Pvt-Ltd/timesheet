import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import App from '../App';
import type { SessionState } from '../src/auth/session-controller';

type StateListener = (next: SessionState) => void;
type StoredTokensShape = NonNullable<AppTestGlobals['__tokens']>;

// The App wires its own client/controller from platform modules, so the tests
// stub those modules and stash handles on globalThis for assertions.
jest.mock('../src/platform/secure-storage', () => {
  const store = {
    read: jest.fn(async () => (globalThis as AppTestGlobals).__tokens ?? null),
    write: jest.fn(async (tokens: StoredTokensShape) => {
      (globalThis as AppTestGlobals).__tokens = tokens;
    }),
    clear: jest.fn(async () => {
      (globalThis as AppTestGlobals).__tokens = null;
    }),
  };
  return {
    __store: store,
    createSecureTokenStore: jest.fn(() => {
      const fail = (globalThis as AppTestGlobals).__failSecureStorage;
      if (fail) throw new Error('Secure storage is not available on this device.');
      return store;
    }),
  };
});

jest.mock('../src/auth/session-controller', () => {
  const controllerFactory = () => {
    let current: SessionState = { status: 'booting' };
    const listeners = new Set<StateListener>();
    function emit(next: SessionState) {
      current = next;
      listeners.forEach((listener) => listener(next));
    }
    const controller = {
      getState: () => current,
      reset() {
        current = { status: 'booting' };
      },
      subscribe: (listener: StateListener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      setBaseUrl: jest.fn(),
      getBaseUrl: () => null,
      signIn: jest.fn(),
      signOut: jest.fn(async () => emit({ status: 'signed-out', baseUrl: null })),
      ensureAccessToken: jest.fn(async () => 'access-token'),
      refreshAccessToken: jest.fn(async () => 'access-token'),
      restore: jest.fn(async () => {
        emit((globalThis as AppTestGlobals).__restoredState ?? { status: 'signed-out', baseUrl: null });
        return current;
      }),
    };
    return { controller, emit };
  };
  const handle = controllerFactory();
  return {
    __handle: handle,
    SessionController: jest.fn(() => handle.controller),
  };
});

jest.mock('../src/api/client', () => {
  const dashboardStub = {
    actor: {
      id: 'u1',
      email: 'user@example.com',
      role: 'user',
      permissionRole: 'user',
      hierarchyRole: 'user',
      isActive: true,
    },
    today: { date: '2026-08-26', hours: 0 },
    week: { from: '', to: '', hours: 0 },
    recentEntries: [],
    quickActions: [],
  };
  return {
    ApiClientError: class extends Error {},
    ApiClient: jest.fn().mockImplementation(() => ({
      setAuthHooks: jest.fn(),
      setBaseUrl: jest.fn(),
      getConfig: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      getMe: jest.fn(async () => dashboardStub.actor),
      getDashboard: jest.fn(async () => dashboardStub),
      getTimesheets: jest.fn(async () => ({ rows: [], count: 0 })),
      logout: jest.fn(),
      logoutAll: jest.fn(),
    })),
  };
});

interface AppTestGlobals {
  __tokens?: { refreshToken: string; sessionId: string; baseUrl?: string } | null;
  __failSecureStorage?: boolean;
  __restoredState?: SessionState;
}

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

// The authenticated shell pulls in list virtualization that is covered by
// its own suites; here we only assert session-driven routing.
jest.mock('../src/navigation/AuthenticatedNavigator', () => {
  const ReactLocal = jest.requireActual('react');
  return {
    __esModule: true,
    AuthenticatedNavigator: ({ onSignOut }: { onSignOut?: () => void }) =>
      ReactLocal.createElement(
        'View',
        { accessibilityLabel: 'authenticated-shell' },
        ReactLocal.createElement('Text', null, 'Authenticated'),
        ReactLocal.createElement('Text', { onPress: onSignOut, accessibilityRole: 'button', accessibilityLabel: 'Sign out' }, 'Sign out'),
      ),
  };
});

function strings(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAll((node) => typeof node.props.children === 'string')
    .map((node) => node.props.children as string)
    .join('\n');
}

async function renderApp() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  // Allow the async environment bootstrap + auto restore to settle.
  await ReactTestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(() => resolve(undefined), 0));
  });
  await ReactTestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(() => resolve(undefined), 0));
  });
  return renderer;
}

describe('App', () => {
  beforeEach(() => {
    (globalThis as AppTestGlobals).__tokens = null;
    (globalThis as AppTestGlobals).__failSecureStorage = false;
    (globalThis as AppTestGlobals).__restoredState = undefined;
    // The mocked controller is shared across tests in this file.
    const mockModule = jest.requireMock('../src/auth/session-controller') as {
      __handle: { controller: { reset(): void } };
    };
    mockModule.__handle.controller.reset();
  });

  it('fails closed when the device cannot provide secure storage', async () => {
    (globalThis as AppTestGlobals).__failSecureStorage = true;

    const renderer = await renderApp();

    expect(strings(renderer)).toContain('Secure storage is not available');
  });

  it('routes an unconfigured device to workspace connection', async () => {
    const renderer = await renderApp();

    expect(renderer.root.findByProps({ accessibilityLabel: 'Workspace address' })).toBeTruthy();
  });

  it('shows the offline recovery path when cold start cannot reach the server', async () => {
    (globalThis as AppTestGlobals).__tokens = {
      refreshToken: 'stored-refresh',
      sessionId: 's1',
      baseUrl: 'https://vsis.example',
    };
    (globalThis as AppTestGlobals).__restoredState = {
      status: 'offline',
      baseUrl: 'https://vsis.example',
      message: 'unreachable',
    };

    const renderer = await renderApp();

    expect(renderer.root.findByProps({ accessibilityLabel: 'Retry connection' })).toBeTruthy();
  });

  it('routes a restored session into the authenticated shell with a sign-out entry point', async () => {
    (globalThis as AppTestGlobals).__tokens = {
      refreshToken: 'stored-refresh',
      sessionId: 's1',
      baseUrl: 'https://vsis.example',
    };
    (globalThis as AppTestGlobals).__restoredState = {
      status: 'signed-in',
      actor: {
        id: 'u1',
        email: 'user@example.com',
        role: 'user',
        permissionRole: 'user',
        hierarchyRole: 'user',
        isActive: true,
      },
      accessToken: 'access-token',
      tokens: { refreshToken: 'stored-refresh', sessionId: 's1', baseUrl: 'https://vsis.example' },
      baseUrl: 'https://vsis.example',
    };

    const renderer = await renderApp();

    expect(renderer.root.findByProps({ accessibilityLabel: 'authenticated-shell' })).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: 'Sign out' })).toBeTruthy();
  });
});
