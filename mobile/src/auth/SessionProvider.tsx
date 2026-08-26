import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiClientError } from '../api/client';
import type {
  CreateLeaveInput,
  CreateReminderInput,
  CreateTimesheetInput,
  LeaveRow,
  MobileActor,
  MobileConfig,
  MobileDashboardData,
  MobileLoginInput,
  MobileReferenceData,
  ReminderItem,
  ReportParams,
  ReportTotals,
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
  reference: MobileReferenceData | null;
  isOffline: boolean;
  connectServer: (url: string) => Promise<MobileConfig>;
  signIn: (credentials: { email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  disconnectServer: () => Promise<void>;
  loadDashboard: () => Promise<MobileDashboardData | null>;
  loadReference: () => Promise<MobileReferenceData | null>;
  listTimesheets: (params?: TimesheetListParams) => Promise<TimesheetListResult>;
  createTimesheet: (input: CreateTimesheetInput) => Promise<void>;
  deleteTimesheet: (id: string) => Promise<void>;
  listLeaves: (params?: { from?: string; to?: string }) => Promise<LeaveRow[]>;
  createLeave: (input: CreateLeaveInput) => Promise<void>;
  deleteLeave: (id: string) => Promise<void>;
  listReminders: () => Promise<ReminderItem[]>;
  createReminder: (input: CreateReminderInput) => Promise<void>;
  updateReminder: (id: string, done: boolean) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
  getReports: (params?: ReportParams) => Promise<ReportTotals>;
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
  const [reference, setReference] = useState<MobileReferenceData | null>(null);
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
        setReference(null);
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

  const loadReference = useCallback(async (): Promise<MobileReferenceData | null> => {
    if (!client || !accessToken || !controller) return null;
    try {
      const data = await client.getReference(accessToken);
      setReference(data);
      return data;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        try {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const retried = await client.getReference(nextToken);
          setReference(retried);
          return retried;
        } catch {
          await signOut();
          return null;
        }
      }
      return null;
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

  const createTimesheet = useCallback(
    async (input: CreateTimesheetInput): Promise<void> => {
      if (!client || !accessToken || !controller) {
        throw new Error('You must be signed in to log time.');
      }
      try {
        await client.createTimesheet(accessToken, input);
        await loadDashboard();
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.createTimesheet(nextToken, input);
          await loadDashboard();
          return;
        }
        throw err;
      }
    },
    [client, accessToken, controller, loadDashboard]
  );

  const deleteTimesheet = useCallback(
    async (id: string): Promise<void> => {
      if (!client || !accessToken || !controller) {
        throw new Error('You must be signed in to delete time.');
      }
      try {
        await client.deleteTimesheet(accessToken, id);
        await loadDashboard();
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.deleteTimesheet(nextToken, id);
          await loadDashboard();
          return;
        }
        throw err;
      }
    },
    [client, accessToken, controller, loadDashboard]
  );

  const listLeaves = useCallback(
    async (params?: { from?: string; to?: string }): Promise<LeaveRow[]> => {
      if (!client || !accessToken || !controller) return [];
      try {
        return await client.listLeaves(accessToken, params);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          return await client.listLeaves(nextToken, params);
        }
        throw err;
      }
    },
    [client, accessToken, controller]
  );

  const createLeave = useCallback(
    async (input: CreateLeaveInput): Promise<void> => {
      if (!client || !accessToken || !controller) {
        throw new Error('You must be signed in to submit leaves.');
      }
      try {
        await client.createLeave(accessToken, input);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.createLeave(nextToken, input);
          return;
        }
        throw err;
      }
    },
    [client, accessToken, controller]
  );

  const deleteLeave = useCallback(
    async (id: string): Promise<void> => {
      if (!client || !accessToken || !controller) {
        throw new Error('You must be signed in to delete leaves.');
      }
      try {
        await client.deleteLeave(accessToken, id);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.deleteLeave(nextToken, id);
          return;
        }
        throw err;
      }
    },
    [client, accessToken, controller]
  );

  const listReminders = useCallback(async (): Promise<ReminderItem[]> => {
    if (!client || !accessToken || !controller) return [];
    try {
      return await client.listReminders(accessToken);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        return await client.listReminders(nextToken);
      }
      throw err;
    }
  }, [client, accessToken, controller]);

  const createReminder = useCallback(
    async (input: CreateReminderInput): Promise<void> => {
      if (!client || !accessToken || !controller) {
        throw new Error('You must be signed in to create reminders.');
      }
      try {
        await client.createReminder(accessToken, input);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.createReminder(nextToken, input);
          return;
        }
        throw err;
      }
    },
    [client, accessToken, controller]
  );

  const updateReminder = useCallback(
    async (id: string, done: boolean): Promise<void> => {
      if (!client || !accessToken || !controller) {
        throw new Error('You must be signed in to update reminders.');
      }
      try {
        await client.updateReminder(accessToken, id, done);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.updateReminder(nextToken, id, done);
          return;
        }
        throw err;
      }
    },
    [client, accessToken, controller]
  );

  const deleteReminder = useCallback(
    async (id: string): Promise<void> => {
      if (!client || !accessToken || !controller) {
        throw new Error('You must be signed in to delete reminders.');
      }
      try {
        await client.deleteReminder(accessToken, id);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.deleteReminder(nextToken, id);
          return;
        }
        throw err;
      }
    },
    [client, accessToken, controller]
  );

  const getReports = useCallback(
    async (params?: ReportParams): Promise<ReportTotals> => {
      if (!client || !accessToken || !controller) {
        return { totalHours: 0, totalEntries: 0, byGroup: [] };
      }
      try {
        return await client.getReports(accessToken, params);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          return await client.getReports(nextToken, params);
        }
        throw err;
      }
    },
    [client, accessToken, controller]
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
      reference,
      isOffline,
      connectServer,
      signIn,
      signOut,
      disconnectServer,
      loadDashboard,
      loadReference,
      listTimesheets,
      createTimesheet,
      deleteTimesheet,
      listLeaves,
      createLeave,
      deleteLeave,
      listReminders,
      createReminder,
      updateReminder,
      deleteReminder,
      getReports,
      clearError,
    }),
    [
      status,
      actor,
      serverUrl,
      config,
      error,
      dashboard,
      reference,
      isOffline,
      connectServer,
      signIn,
      signOut,
      disconnectServer,
      loadDashboard,
      loadReference,
      listTimesheets,
      createTimesheet,
      deleteTimesheet,
      listLeaves,
      createLeave,
      deleteLeave,
      listReminders,
      createReminder,
      updateReminder,
      deleteReminder,
      getReports,
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
