import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, Pressable } from 'react-native';
import { SessionProvider, useSession } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

function TestConsumer() {
  const { status, actor, connectServer, signIn, signOut, isOffline } = useSession();
  return (
    <>
      <Text testID="status">{status}</Text>
      <Text testID="actor">{actor?.email ?? 'none'}</Text>
      <Text testID="offline">{String(isOffline)}</Text>
      <Pressable
        testID="connect-btn"
        onPress={() => connectServer('https://timesheet.example.com')}
      />
      <Pressable
        testID="signin-btn"
        onPress={() => signIn({ email: 'test@example.com', password: 'pass' })}
      />
      <Pressable testID="signout-btn" onPress={() => signOut()} />
    </>
  );
}

describe('SessionProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes in disconnected status and transitions on connect and sign in', async () => {
    const mockGetConfig = jest.fn().mockResolvedValue({
      apiVersion: 1,
      appVersion: '1.0.0',
      backend: 'native',
      capabilities: { bearerAuth: true, mobileApi: true },
    });
    const mockLogin = jest.fn().mockResolvedValue({
      accessToken: 'acc-1',
      refreshToken: 'ref-1',
      accessTokenExpiresAt: '2026-08-26T12:00:00Z',
      sessionId: 'sess-1',
      actor: {
        id: 'u1',
        email: 'test@example.com',
        role: 'user',
        permissionRole: 'user',
        hierarchyRole: 'user',
        isActive: true,
      },
    });

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: mockGetConfig,
        login: mockLogin,
        refresh: jest.fn(),
        getMe: jest.fn(),
        getDashboard: jest.fn(),
        listTimesheets: jest.fn(),
        getReference: jest.fn(),
        logout: jest.fn().mockResolvedValue(undefined),
        logoutAll: jest.fn().mockResolvedValue(undefined),
        baseUrl: 'https://timesheet.example.com',
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider tokenStore={store}>
          <TestConsumer />
        </SessionProvider>
      );
    });

    const statusNode = renderer!.root.findByProps({ testID: 'status' });
    expect(statusNode.props.children).toBe('disconnected');

    // Connect workspace
    const connectBtn = renderer!.root.findByProps({ testID: 'connect-btn' });
    await ReactTestRenderer.act(async () => {
      await connectBtn.props.onPress();
    });

    expect(statusNode.props.children).toBe('signed-out');

    // Sign in
    const signInBtn = renderer!.root.findByProps({ testID: 'signin-btn' });
    await ReactTestRenderer.act(async () => {
      await signInBtn.props.onPress();
    });

    expect(statusNode.props.children).toBe('signed-in');
    const actorNode = renderer!.root.findByProps({ testID: 'actor' });
    expect(actorNode.props.children).toBe('test@example.com');

    // Sign out
    const signOutBtn = renderer!.root.findByProps({ testID: 'signout-btn' });
    await ReactTestRenderer.act(async () => {
      await signOutBtn.props.onPress();
    });

    expect(statusNode.props.children).toBe('signed-out');
  });

  it('transitions pending approval to signed-in via checkStatus', async () => {
    let currentActor = {
      id: 'u-pending',
      email: 'pending@example.com',
      role: 'user',
      permissionRole: 'user',
      hierarchyRole: 'user',
      isActive: false,
    };

    const mockGetConfig = jest.fn().mockResolvedValue({
      apiVersion: 1,
      appVersion: '1.0.0',
      backend: 'native',
      capabilities: { bearerAuth: true, mobileApi: true },
    });
    const mockLogin = jest.fn().mockResolvedValue({
      accessToken: 'acc-1',
      refreshToken: 'ref-1',
      accessTokenExpiresAt: '2026-08-26T12:00:00Z',
      sessionId: 'sess-1',
      actor: currentActor,
    });
    const mockGetMe = jest.fn().mockImplementation(() => Promise.resolve(currentActor));

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: mockGetConfig,
        login: mockLogin,
        refresh: jest.fn(),
        getMe: mockGetMe,
        logout: jest.fn().mockResolvedValue(undefined),
        logoutAll: jest.fn().mockResolvedValue(undefined),
        baseUrl: 'https://timesheet.example.com',
      } as unknown as ApiClient;
    });

    function PendingConsumer() {
      const { status, actor, connectServer, signIn, checkStatus } = useSession();
      return (
        <>
          <Text testID="status">{status}</Text>
          <Text testID="actor">{actor?.email ?? 'none'}</Text>
          <Pressable
            testID="connect-btn"
            onPress={() => connectServer('https://timesheet.example.com')}
          />
          <Pressable
            testID="signin-btn"
            onPress={() => signIn({ email: 'pending@example.com', password: 'pass' })}
          />
          <Pressable testID="check-status-btn" onPress={() => checkStatus()} />
        </>
      );
    }

    const store = new MemoryTokenStore();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider tokenStore={store}>
          <PendingConsumer />
        </SessionProvider>
      );
    });

    const statusNode = renderer!.root.findByProps({ testID: 'status' });
    const connectBtn = renderer!.root.findByProps({ testID: 'connect-btn' });
    await ReactTestRenderer.act(async () => {
      await connectBtn.props.onPress();
    });

    const signInBtn = renderer!.root.findByProps({ testID: 'signin-btn' });
    await ReactTestRenderer.act(async () => {
      await signInBtn.props.onPress();
    });

    expect(statusNode.props.children).toBe('pending-approval');

    // Admin activates account
    currentActor = { ...currentActor, isActive: true };

    const checkBtn = renderer!.root.findByProps({ testID: 'check-status-btn' });
    await ReactTestRenderer.act(async () => {
      await checkBtn.props.onPress();
    });

    expect(statusNode.props.children).toBe('signed-in');
  });
});
