import React from 'react';
import { SessionProvider } from './auth/SessionProvider';
import type { SessionController, SessionState } from './auth/session-controller';
import type { ApiClient } from './api/client';

export function signedInState(overrides: Partial<Extract<SessionState, { status: 'signed-in' }>> = {}): SessionState {
  return {
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
    tokens: { refreshToken: 'refresh-token', sessionId: 'session-1', baseUrl: 'https://vsis.example' },
    baseUrl: 'https://vsis.example',
    ...overrides,
  };
}

/**
 * Builds a minimal SessionController stand-in with the given fixed state and
 * jest mocks for the actions screens use.
 */
export function fakeController(state: SessionState, overrides: Partial<Record<'signIn' | 'signOut' | 'signOutAllDevices' | 'restore' | 'ensureAccessToken' | 'setBaseUrl' | 'getBaseUrl', jest.Mock>> = {}) {
  let current = state;
  const listeners = new Set<(next: SessionState) => void>();
  const controller = {
    getState: () => current,
    subscribe: (listener: (next: SessionState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    signIn: overrides.signIn ?? jest.fn().mockResolvedValue(undefined),
    signOut: overrides.signOut ?? jest.fn().mockResolvedValue(undefined),
    signOutAllDevices: overrides.signOutAllDevices ?? jest.fn().mockResolvedValue(undefined),
    restore: overrides.restore ?? jest.fn().mockResolvedValue(state),
    ensureAccessToken: overrides.ensureAccessToken ?? jest.fn().mockResolvedValue('access-token'),
    setBaseUrl: overrides.setBaseUrl ?? jest.fn(),
    getBaseUrl: () => (current.status === 'signed-out' ? current.baseUrl : null),
    emit(next: SessionState) {
      current = next;
      for (const listener of listeners) listener(next);
    },
  };
  return controller as unknown as SessionController & { emit: (next: SessionState) => void };
}

export function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getConfig: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    getMe: jest.fn(),
    getDashboard: jest.fn(),
    getTimesheets: jest.fn(),
    getReference: jest.fn(),
    logout: jest.fn(),
    logoutAll: jest.fn(),
    setAuthHooks: jest.fn(),
    setBaseUrl: jest.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

export function withSession(controller: SessionController, client: ApiClient, children: React.ReactNode) {
  return (
    <SessionProvider client={client} controller={controller} autoRestore={false}>
      {children}
    </SessionProvider>
  );
}
