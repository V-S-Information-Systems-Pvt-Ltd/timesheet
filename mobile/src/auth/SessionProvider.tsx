import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiClientError } from '../api/client';
import type {
  MobileActor,
  MobileConfig,
  MobileDashboardData,
  MobileLoginInput,
  TimesheetListParams,
  TimesheetListResult,
} from '../api/contracts';
import { SessionController, type SessionState } from './session-controller';
import { createTokenStore, type SecureTokenStore } from '../platform/secure-storage';
import { dashboardCache } from '../storage/dashboard-cache';

export type SessionStatus =
  | 'booting'
  | 'disconnected'
  | 'signed-out'
  | 'signing-in'
  | 'signed-in'
  | 'refreshing'
  | 'pending-approval'
  | 'error';

export interface SessionContextValue {
  status: SessionStatus;
  actor: MobileActor | null;
  serverUrl: string | null;
  config: MobileConfig | null;
  error: string | null;
  dashboard: MobileDashboardData | null;
  isOffline: boolean;
  connectServer: (url: string) => Promise<MobileConfig>;
  signIn: (credentials: { email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  disconnectServer: () => Promise<void>;
  loadDashboard: () => Promise<MobileDashboardData | null>;
  listTimesheets: (params?: TimesheetListParams) => Promise<TimesheetListResult>;
  clearError: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  children: React.ReactNode;
  tokenStore?: SecureTokenStore;
  initialServerUrl?: string;
}

export function SessionProvider({
  children,
  tokenStore,
  initialServerUrl,
}: SessionProviderProps) {
  const store = useMemo(() => tokenStore ?? createTokenStore(), [tokenStore]);
  const [serverUrl, setServerUrl] = useState<string | null>(initialServerUrl ?? null);
  const [config, setConfig] = useState<MobileConfig | null>(null);
  const [status, setStatus] = useState<SessionStatus>('booting');
  const [actor, setActor] = useState<MobileActor | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<MobileDashboardData | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const client = useMemo(() => {
    return serverUrl ? new ApiClient(serverUrl) : null;
  }, [serverUrl]);

  const controller = useMemo(() => {
    return client ? new SessionController(client, store) : null;
  }, [client, store]);

  const applyControllerState = useCallback((state: SessionState) => {
    switch (state.status) {
      case 'signed-in':
        setStatus('signed-in');
        setActor(state.actor);
        setAccessToken(state.accessToken);
        setIsOffline(false);
        setError(null);
        break;
      case 'pending-approval':
        setStatus('pending-approval');
        setActor(state.actor);
        setAccessToken(state.accessToken);
        setIsOffline(false);
        setError(null);
        break;
      case 'offline': {
        setIsOffline(true);
        const cached = dashboardCache.get();
        if (cached) {
          setDashboard(cached);
          setActor(cached.actor);
          setStatus('signed-in');
        } else {
          setStatus('signed-out');
        }
        setError(null);
        break;
      }
      case 'loading':
        setStatus('signing-in');
        break;
      case 'error':
        setStatus('error');
        setError(state.message);
        break;
      case 'signed-out':
      default:
        setStatus('signed-out');
        setActor(null);
        setAccessToken(null);
        setDashboard(null);
        break;
    }
  }, []);

  const connectServer = useCallback(
    async (url: string): Promise<MobileConfig> => {
      setError(null);
      const nextClient = new ApiClient(url);
      const fetchedConfig = await nextClient.getConfig();
      setServerUrl(url);
      setConfig(fetchedConfig);

      const nextController = new SessionController(nextClient, store);
      const restored = await nextController.restore();
      applyControllerState(restored);
      return fetchedConfig;
    },
    [store, applyControllerState]
  );

  const signIn = useCallback(
    async (credentials: { email: string; password: string }): Promise<void> => {
      if (!controller) {
        throw new Error('Connect to a workspace before signing in.');
      }
      setError(null);
      setStatus('signing-in');
      const input: MobileLoginInput = {
        email: credentials.email,
        password: credentials.password,
      };
      const result = await controller.signIn(input);
      applyControllerState(result);
    },
    [controller, applyControllerState]
  );

  const signOut = useCallback(async (): Promise<void> => {
    if (controller) {
      await controller.signOut();
      applyControllerState({ status: 'signed-out' });
    }
    dashboardCache.clear();
  }, [controller, applyControllerState]);

  const disconnectServer = useCallback(async (): Promise<void> => {
    await signOut();
    setServerUrl(null);
    setConfig(null);
    setStatus('disconnected');
  }, [signOut]);

  const loadDashboard = useCallback(async (): Promise<MobileDashboardData | null> => {
    if (!client || !accessToken || !controller) {
      const cached = dashboardCache.get();
      if (cached) setDashboard(cached);
      return cached;
    }

    try {
      setIsOffline(false);
      const data = await client.getDashboard(accessToken);
      setDashboard(data);
      dashboardCache.set(data);
      return data;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        try {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const retriedData = await client.getDashboard(nextToken);
          setDashboard(retriedData);
          dashboardCache.set(retriedData);
          return retriedData;
        } catch {
          await signOut();
          return null;
        }
      }
      setIsOffline(true);
      const cached = dashboardCache.get();
      if (cached) setDashboard(cached);
      return cached;
    }
  }, [client, accessToken, controller, signOut]);

  const listTimesheets = useCallback(
    async (params?: TimesheetListParams): Promise<TimesheetListResult> => {
      if (!client || !accessToken || !controller) {
        return { rows: [] };
      }
      try {
        return await client.listTimesheets(accessToken, params);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          try {
            const nextToken = await controller.refreshAccessToken();
            setAccessToken(nextToken);
            return await client.listTimesheets(nextToken, params);
          } catch {
            await signOut();
            return { rows: [] };
          }
        }
        throw err;
      }
    },
    [client, accessToken, controller, signOut]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Boot restore lifecycle
  useEffect(() => {
    let mounted = true;

    async function init() {
      if (initialServerUrl) {
        try {
          await connectServer(initialServerUrl);
        } catch {
          if (mounted) setStatus('disconnected');
        }
      } else {
        setStatus('disconnected');
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, [initialServerUrl, connectServer]);

  const contextValue: SessionContextValue = useMemo(
    () => ({
      status,
      actor,
      serverUrl,
      config,
      error,
      dashboard,
      isOffline,
      connectServer,
      signIn,
      signOut,
      disconnectServer,
      loadDashboard,
      listTimesheets,
      clearError,
    }),
    [
      status,
      actor,
      serverUrl,
      config,
      error,
      dashboard,
      isOffline,
      connectServer,
      signIn,
      signOut,
      disconnectServer,
      loadDashboard,
      listTimesheets,
      clearError,
    ]
  );

  return <SessionContext.Provider value={contextValue}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider.');
  }
  return context;
}
