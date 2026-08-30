import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, Pressable } from 'react-native';
import {
  SessionProvider,
  useSession,
  useSessionStatus,
  useSessionActor,
  useSessionSync,
  useSessionDashboard,
  useSessionReference,
} from '../src/auth/SessionProvider';
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

  it('normalizes server URL without scheme and connects successfully', async () => {
    const mockGetConfig = jest.fn().mockResolvedValue({
      apiVersion: 1,
      appVersion: '1.0.0',
      capabilities: { bearerAuth: true, mobileApi: true },
    });

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation((baseUrl: string) => {
      return {
        baseUrl,
        getConfig: mockGetConfig,
      } as unknown as ApiClient;
    });

    function NormalizationConsumer() {
      const { status, connectServer } = useSession();
      return (
        <>
          <Text testID="status">{status}</Text>
          <Pressable
            testID="connect-no-scheme"
            onPress={() => connectServer('timesheet.internal.lan:3000')}
          />
        </>
      );
    }

    const store = new MemoryTokenStore();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider tokenStore={store}>
          <NormalizationConsumer />
        </SessionProvider>
      );
    });

    const connectBtn = renderer!.root.findByProps({ testID: 'connect-no-scheme' });
    await ReactTestRenderer.act(async () => {
      await connectBtn.props.onPress();
    });

    expect(mockGetConfig).toHaveBeenCalled();
  });

  it('deduplicates concurrent loadReference calls into a single API request', async () => {
    let resolveRef: (val: unknown) => void;
    const refPromise = new Promise((res) => {
      resolveRef = res;
    });
    const mockGetReference = jest.fn().mockImplementation(() => refPromise);
    const mockGetConfig = jest.fn().mockResolvedValue({
      apiVersion: 1,
      appVersion: '1.0.0',
      capabilities: { bearerAuth: true, mobileApi: true },
    });
    const mockLogin = jest.fn().mockResolvedValue({
      accessToken: 'acc-1',
      refreshToken: 'ref-1',
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
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

    let sessionApi: ReturnType<typeof useSession> | null = null;
    function RefConsumer() {
      sessionApi = useSession();
      return <Text testID="ref-test">ready</Text>;
    }

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation((baseUrl: string) => {
      return {
        baseUrl,
        getConfig: mockGetConfig,
        login: mockLogin,
        getReference: mockGetReference,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider tokenStore={store}>
          <RefConsumer />
        </SessionProvider>
      );
    });

    await ReactTestRenderer.act(async () => {
      await sessionApi!.connectServer('https://timesheet.example.com');
      await sessionApi!.signIn({ email: 'test@example.com', password: 'pass' });
    });

    let p1: Promise<unknown>;
    let p2: Promise<unknown>;
    await ReactTestRenderer.act(async () => {
      p1 = sessionApi!.loadReference();
      p2 = sessionApi!.loadReference();
      resolveRef!({ projects: [], activityTypes: [], titles: [] });
      await Promise.all([p1, p2]);
    });

    expect(mockGetReference).toHaveBeenCalledTimes(1);
  });

  it('exposes granular selector hooks (status, actor, sync, dashboard, reference)', async () => {
    let statusSlice: ReturnType<typeof useSessionStatus> | null = null;
    let actorSlice: ReturnType<typeof useSessionActor> | null = null;
    let syncSlice: ReturnType<typeof useSessionSync> | null = null;
    let dashSlice: ReturnType<typeof useSessionDashboard> | null = null;
    let refSlice: ReturnType<typeof useSessionReference> | null = null;

    function SliceConsumer() {
      statusSlice = useSessionStatus();
      actorSlice = useSessionActor();
      syncSlice = useSessionSync();
      dashSlice = useSessionDashboard();
      refSlice = useSessionReference();
      return <Text testID="slice-consumer">ok</Text>;
    }

    const store = new MemoryTokenStore();
    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <SessionProvider tokenStore={store}>
          <SliceConsumer />
        </SessionProvider>
      );
    });

    expect(['disconnected', 'signed-out']).toContain(statusSlice!.status);
    expect(actorSlice!.actor).toBeNull();
    expect(syncSlice!.pendingCount).toBe(0);
    expect(dashSlice!.dashboard).toBeNull();
    expect(refSlice!.reference).toBeNull();
    expect(typeof statusSlice!.checkStatus).toBe('function');
    expect(typeof syncSlice!.flushQueue).toBe('function');
    expect(typeof dashSlice!.loadDashboard).toBe('function');
    expect(typeof refSlice!.loadReference).toBe('function');
  });
});
