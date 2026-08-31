import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiClientError } from '../api/client';
import type {
  ChangePasswordInput,
  CreateLeaveInput,
  CreateReminderInput,
  CreateTimesheetInput,
  LeaveRow,
  MobileActor,
  MobileConfig,
  MobileDashboardData,
  MobileLoginInput,
  MobileReferenceData,
  PersonProfile,
  ReminderItem,
  ReportParams,
  ReportTotals,
  TimesheetListParams,
  TimesheetListResult,
  TimesheetEntry,
  BatchDeleteTimesheetsResponse,
  BatchDuplicateItem,
  BatchDuplicateTimesheetsResponse,
  GlobalReminderItem,
  UpdateProfileInput,
  SignupInput,
  SignupResult,
  MobileLayout,
  MobileLayoutResponse,
  WorkspaceBranding,
  ProjectAdminItem,
  CreateProjectInput,
  UpdateProjectInput,
  ActivityTypeAdminItem,
  CreateActivityTypeInput,
  UpdateActivityTypeInput,
  CreateAdminUserInput,
  UpdateAdminUserInput,
  TitleAdminItem,
  CreateTitleInput,
  ReclassifyTitleInput,
  BackfillSettings,
  CreateAdminLeaveInput,
  CreateGlobalReminderInput,
} from '../api/contracts';
import { DEFAULT_BRANDING } from '../api/contracts';
import { DEFAULT_MOBILE_LAYOUT } from '../navigation/modules';
import { SessionController, type SessionState } from './session-controller';
import { createTokenStore, type SecureTokenStore } from '../platform/secure-storage';
import { dashboardCache } from '../storage/dashboard-cache';
import { workspaceStore } from '../storage/workspace-store';
import {
  offlineQueue,
  type OfflineMutationPayload,
  type OfflineMutationType,
  type QueuedOfflineMutation,
} from '../storage/offline-queue';
import { syncEngine, type SyncResult } from '../sync/sync-engine';
import { telemetry } from '../telemetry/telemetry';

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
  effectiveActor: MobileActor | null;
  serverUrl: string | null;
  config: MobileConfig | null;
  branding: WorkspaceBranding;
  error: string | null;
  dashboard: MobileDashboardData | null;
  reference: MobileReferenceData | null;
  globalReminders: GlobalReminderItem[];
  layout: MobileLayout;
  isOffline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  flushQueue: () => Promise<SyncResult>;
  queueMutation: (
    type: OfflineMutationType,
    payload: OfflineMutationPayload
  ) => Promise<QueuedOfflineMutation>;
  connectServer: (url: string) => Promise<MobileConfig>;
  signIn: (credentials: { email: string; password: string }) => Promise<void>;
  signup: (input: SignupInput) => Promise<SignupResult>;
  signOut: () => Promise<void>;
  logoutAll: () => Promise<void>;
  disconnectServer: () => Promise<void>;
  updateBranding: (branding: WorkspaceBranding) => Promise<void>;
  resetBranding: () => Promise<void>;
  loadDashboard: () => Promise<MobileDashboardData | null>;
  loadReference: () => Promise<MobileReferenceData | null>;
  loadGlobalReminders: () => Promise<GlobalReminderItem[]>;
  dismissGlobalReminder: (id: string) => Promise<void>;
  loadLayout: () => Promise<MobileLayoutResponse | null>;
  updateLayout: (layout: MobileLayout) => Promise<void>;
  resetLayout: () => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<MobileActor>;
  listTimesheets: (params?: TimesheetListParams) => Promise<TimesheetListResult>;
  createTimesheet: (input: CreateTimesheetInput) => Promise<void>;
  updateTimesheet: (id: string, input: CreateTimesheetInput) => Promise<void>;
  deleteTimesheet: (id: string) => Promise<void>;
  deleteTimesheets: (ids: string[]) => Promise<BatchDeleteTimesheetsResponse>;
  duplicateTimesheet: (id: string, targetDate?: string) => Promise<TimesheetEntry>;
  duplicateTimesheets: (items: BatchDuplicateItem[]) => Promise<BatchDuplicateTimesheetsResponse>;
  listLeaves: (params?: { from?: string; to?: string }) => Promise<LeaveRow[]>;
  createLeave: (input: CreateLeaveInput) => Promise<void>;
  deleteLeave: (id: string) => Promise<void>;
  listReminders: () => Promise<ReminderItem[]>;
  createReminder: (input: CreateReminderInput) => Promise<void>;
  updateReminder: (id: string, done: boolean) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
  getReports: (params?: ReportParams) => Promise<ReportTotals>;
  listPeople: () => Promise<PersonProfile[]>;
  changePassword: (input: ChangePasswordInput) => Promise<void>;
  listAdminProjects: () => Promise<ProjectAdminItem[]>;
  createAdminProject: (input: CreateProjectInput) => Promise<ProjectAdminItem>;
  updateAdminProject: (id: string, input: UpdateProjectInput) => Promise<ProjectAdminItem>;
  deleteAdminProject: (id: string) => Promise<void>;
  listAdminActivityTypes: () => Promise<ActivityTypeAdminItem[]>;
  createAdminActivityType: (input: CreateActivityTypeInput) => Promise<ActivityTypeAdminItem>;
  updateAdminActivityType: (id: string, input: UpdateActivityTypeInput) => Promise<ActivityTypeAdminItem>;
  deleteAdminActivityType: (id: string) => Promise<void>;
  listAdminUsers: () => Promise<PersonProfile[]>;
  createAdminUser: (input: CreateAdminUserInput) => Promise<PersonProfile>;
  updateAdminUser: (id: string, input: UpdateAdminUserInput) => Promise<PersonProfile>;
  listAdminTitles: () => Promise<TitleAdminItem[]>;
  createAdminTitle: (input: CreateTitleInput) => Promise<TitleAdminItem>;
  reclassifyAdminTitle: (input: ReclassifyTitleInput) => Promise<{ name: string; hierarchyRole: string; affectedCount?: number }>;
  deleteAdminTitle: (name: string) => Promise<void>;
  getBackfillSettings: () => Promise<BackfillSettings>;
  updateBackfillSettings: (settings: BackfillSettings) => Promise<BackfillSettings>;
  listAdminLeaves: (params?: { userId?: string; from?: string; to?: string }) => Promise<LeaveRow[]>;
  createAdminLeave: (input: CreateAdminLeaveInput) => Promise<void>;
  deleteAdminLeave: (id: string) => Promise<void>;
  listAllGlobalReminders: () => Promise<GlobalReminderItem[]>;
  createAdminGlobalReminder: (input: CreateGlobalReminderInput) => Promise<GlobalReminderItem>;
  deleteAdminGlobalReminder: (id: string) => Promise<void>;
  checkStatus: () => Promise<SessionState>;
  clearError: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export type SessionStatusContextValue = Pick<
  SessionContextValue,
  'status' | 'actor' | 'effectiveActor' | 'serverUrl' | 'config' | 'branding' | 'error' | 'clearError' | 'checkStatus'
>;

export type SessionSyncContextValue = Pick<
  SessionContextValue,
  'isOffline' | 'pendingCount' | 'isSyncing' | 'flushQueue' | 'queueMutation'
>;

export type SessionDataContextValue = Pick<
  SessionContextValue,
  'dashboard' | 'reference' | 'globalReminders' | 'layout' | 'loadDashboard' | 'loadReference' | 'loadGlobalReminders' | 'dismissGlobalReminder' | 'loadLayout'
>;

export type SessionActionsContextValue = Pick<
  SessionContextValue,
  | 'connectServer'
  | 'signIn'
  | 'signup'
  | 'signOut'
  | 'logoutAll'
  | 'disconnectServer'
  | 'updateBranding'
  | 'resetBranding'
  | 'updateLayout'
  | 'resetLayout'
  | 'updateProfile'
  | 'listTimesheets'
  | 'createTimesheet'
  | 'updateTimesheet'
  | 'deleteTimesheet'
  | 'deleteTimesheets'
  | 'duplicateTimesheet'
  | 'duplicateTimesheets'
  | 'listLeaves'
  | 'createLeave'
  | 'deleteLeave'
  | 'listReminders'
  | 'createReminder'
  | 'updateReminder'
  | 'deleteReminder'
  | 'getReports'
  | 'listPeople'
  | 'changePassword'
  | 'listAdminProjects'
  | 'createAdminProject'
  | 'updateAdminProject'
  | 'deleteAdminProject'
  | 'listAdminActivityTypes'
  | 'createAdminActivityType'
  | 'updateAdminActivityType'
  | 'deleteAdminActivityType'
  | 'listAdminUsers'
  | 'createAdminUser'
  | 'updateAdminUser'
  | 'listAdminTitles'
  | 'createAdminTitle'
  | 'reclassifyAdminTitle'
  | 'deleteAdminTitle'
  | 'getBackfillSettings'
  | 'updateBackfillSettings'
  | 'listAdminLeaves'
  | 'createAdminLeave'
  | 'deleteAdminLeave'
  | 'listAllGlobalReminders'
  | 'createAdminGlobalReminder'
  | 'deleteAdminGlobalReminder'
>;

const SessionStatusContext = createContext<SessionStatusContextValue | null>(null);
const SessionSyncContext = createContext<SessionSyncContextValue | null>(null);
const SessionDataContext = createContext<SessionDataContextValue | null>(null);
const SessionActionsContext = createContext<SessionActionsContextValue | null>(null);

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
  const [globalReminders, setGlobalReminders] = useState<GlobalReminderItem[]>([]);
  const [layout, setLayout] = useState<MobileLayout>(DEFAULT_MOBILE_LAYOUT);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const client = useMemo(() => {
    return serverUrl ? new ApiClient(serverUrl) : null;
  }, [serverUrl]);

  const controller = useMemo(() => {
    if (!client) return null;
    const ctrl = new SessionController(client, store);
    if (typeof client.setTokenRefreshHandler === 'function') {
      client.setTokenRefreshHandler(async () => {
        const refreshed = await ctrl.refreshAccessToken();
        setAccessToken(refreshed);
        return refreshed;
      });
    }
    return ctrl;
  }, [client, store]);

  const serverUrlRef = React.useRef<string | null>(serverUrl);
  serverUrlRef.current = serverUrl;
  const actorRef = React.useRef<MobileActor | null>(actor);
  actorRef.current = actor;
  const inFlightReferencePromiseRef = React.useRef<Promise<MobileReferenceData | null> | null>(null);

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
        const cached = dashboardCache.get(serverUrlRef.current ?? undefined, actorRef.current?.id ?? undefined);
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
    async (rawUrl: string): Promise<MobileConfig> => {
      setError(null);
      let trimmed = (rawUrl || '').trim();
      if (!trimmed) {
        throw new Error('Please enter a valid server URL (e.g. https://timesheet.example.com).');
      }
      if (!/^https?:\/\//i.test(trimmed)) {
        trimmed = `https://${trimmed}`;
      }
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        throw new Error('Please enter a valid server URL (e.g. https://timesheet.example.com).');
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('Unsupported protocol. Use HTTPS (or HTTP for local testing).');
      }
      const host = parsed.host || parsed.hostname;
      if (!host) {
        throw new Error('Please enter a valid server URL with a valid host.');
      }
      const canonicalUrl = `${parsed.protocol}//${host}`;

      const nextClient = new ApiClient(canonicalUrl);
      const fetchedConfig = await nextClient.getConfig();
      if (fetchedConfig.apiVersion !== 1) {
        throw new Error(`Incompatible server API version (${fetchedConfig.apiVersion}). Client requires version 1.`);
      }
      if (!fetchedConfig.capabilities?.mobileApi) {
        throw new Error('Server does not support the mobile API.');
      }

      setServerUrl(canonicalUrl);
      setConfig(fetchedConfig);
      await workspaceStore.set(canonicalUrl);

      const nextController = new SessionController(nextClient, store);
      if (typeof nextClient.setTokenRefreshHandler === 'function') {
        nextClient.setTokenRefreshHandler(async () => {
          const refreshed = await nextController.refreshAccessToken();
          setAccessToken(refreshed);
          return refreshed;
        });
      }
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
      if (config?.capabilities && config.capabilities.bearerAuth === false) {
        const msg = 'Mobile password sign-in is disabled on this server.';
        setError(msg);
        setStatus('signed-out');
        throw new Error(msg);
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
    [controller, config, applyControllerState]
  );

  const checkStatus = useCallback(async (): Promise<SessionState> => {
    if (!controller) {
      throw new Error('Not connected to a workspace.');
    }
    setError(null);
    const result = await controller.checkStatus();
    applyControllerState(result);
    return result;
  }, [controller, applyControllerState]);

  const signOut = useCallback(async (): Promise<void> => {
    if (controller) {
      await controller.signOut();
      applyControllerState({ status: 'signed-out' });
    }
    dashboardCache.clear(serverUrl ?? undefined, actor?.id ?? undefined);
  }, [controller, applyControllerState, serverUrl, actor]);

  const logoutAll = useCallback(async (): Promise<void> => {
    if (controller) {
      await controller.logoutAll();
      applyControllerState({ status: 'signed-out' });
    }
    dashboardCache.clear(serverUrl ?? undefined, actor?.id ?? undefined);
  }, [controller, applyControllerState, serverUrl, actor]);

  const disconnectServer = useCallback(async (): Promise<void> => {
    await signOut();
    await workspaceStore.clear();
    setServerUrl(null);
    setConfig(null);
    setStatus('disconnected');
  }, [signOut]);

  const getValidToken = useCallback(async (): Promise<string> => {
    if (!client || !controller) {
      throw new Error('Not connected to a workspace.');
    }
    if (accessToken) return accessToken;
    try {
      const refreshed = await controller.refreshAccessToken();
      setAccessToken(refreshed);
      setIsOffline(false);
      return refreshed;
    } catch (err) {
      if (!isOffline) setIsOffline(true);
      throw err;
    }
  }, [client, controller, accessToken, isOffline]);

  const loadDashboard = useCallback(async (): Promise<MobileDashboardData | null> => {
    if (!client || !controller) {
      const cached = dashboardCache.get(serverUrl ?? undefined, actor?.id ?? undefined);
      if (cached) setDashboard(cached);
      return cached;
    }

    try {
      const token = await getValidToken();
      setIsOffline(false);
      const data = await client.getDashboard(token);
      setDashboard(data);
      if (serverUrl && data.actor?.id) {
        dashboardCache.set(serverUrl, data.actor.id, data);
      }
      return data;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        await signOut();
        return null;
      }
      setIsOffline(true);
      const cached = dashboardCache.get(serverUrl ?? undefined, actor?.id ?? undefined);
      if (cached) setDashboard(cached);
      return cached;
    }
  }, [client, controller, getValidToken, signOut, serverUrl, actor]);

  const loadReference = useCallback(async (force = false): Promise<MobileReferenceData | null> => {
    if (!client || !controller) return null;
    if (!force && inFlightReferencePromiseRef.current) {
      return inFlightReferencePromiseRef.current;
    }

    const fetchPromise = (async (): Promise<MobileReferenceData | null> => {
      try {
        const token = await getValidToken();
        const data = await client.getReference(token);
        setReference(data);
        setIsOffline(false);
        return data;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          try {
            const nextToken = await controller.refreshAccessToken();
            setAccessToken(nextToken);
            const retried = await client.getReference(nextToken);
            setReference(retried);
            setIsOffline(false);
            return retried;
          } catch {
            await signOut();
            return null;
          }
        }
        return null;
      } finally {
        inFlightReferencePromiseRef.current = null;
      }
    })();

    inFlightReferencePromiseRef.current = fetchPromise;
    return fetchPromise;
  }, [client, controller, getValidToken, signOut]);

  const listTimesheets = useCallback(
    async (params?: TimesheetListParams): Promise<TimesheetListResult> => {
      if (!client || !controller) {
        return { rows: [] };
      }
      try {
        const token = await getValidToken();
        const res = await client.listTimesheets(token, params);
        setIsOffline(false);
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          try {
            const nextToken = await controller.refreshAccessToken();
            setAccessToken(nextToken);
            const res = await client.listTimesheets(nextToken, params);
            setIsOffline(false);
            return res;
          } catch {
            await signOut();
            return { rows: [] };
          }
        }
        throw err;
      }
    },
    [client, controller, getValidToken, signOut]
  );

  const createTimesheet = useCallback(
    async (input: CreateTimesheetInput): Promise<void> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to log time.');
      }
      try {
        const token = await getValidToken();
        await client.createTimesheet(token, input);
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
    [client, controller, getValidToken, loadDashboard]
  );

  const updateTimesheet = useCallback(
    async (id: string, input: CreateTimesheetInput): Promise<void> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to edit time.');
      }
      try {
        const token = await getValidToken();
        await client.updateTimesheet(token, id, input);
        await loadDashboard();
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.updateTimesheet(nextToken, id, input);
          await loadDashboard();
          return;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadDashboard]
  );

  const duplicateTimesheet = useCallback(
    async (id: string, targetDate?: string): Promise<TimesheetEntry> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to duplicate time.');
      }
      try {
        const token = await getValidToken();
        const res = await client.duplicateTimesheet(token, id, targetDate);
        await loadDashboard();
        return res.entry;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.duplicateTimesheet(nextToken, id, targetDate);
          await loadDashboard();
          return res.entry;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadDashboard]
  );

  const duplicateTimesheets = useCallback(
    async (items: BatchDuplicateItem[]): Promise<BatchDuplicateTimesheetsResponse> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to duplicate time.');
      }
      if (items.length === 0) {
        return { results: [], duplicatedCount: 0 };
      }
      try {
        const token = await getValidToken();
        const res = await client.duplicateTimesheets(token, items);
        await loadDashboard();
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.duplicateTimesheets(nextToken, items);
          await loadDashboard();
          return res;
        }
        await loadDashboard();
        throw err;
      }
    },
    [client, controller, getValidToken, loadDashboard]
  );

  const deleteTimesheet = useCallback(
    async (id: string): Promise<void> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to delete time.');
      }
      // Optimistically remove from dashboard recentEntries for instant UI response
      setDashboard((prev) =>
        prev
          ? {
              ...prev,
              recentEntries: prev.recentEntries.filter((e) => e.id !== id),
            }
          : null
      );
      try {
        const token = await getValidToken();
        await client.deleteTimesheet(token, id);
        await loadDashboard();
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.deleteTimesheet(nextToken, id);
          await loadDashboard();
          return;
        }
        await loadDashboard();
        throw err;
      }
    },
    [client, controller, getValidToken, loadDashboard]
  );

  const deleteTimesheets = useCallback(
    async (ids: string[]): Promise<BatchDeleteTimesheetsResponse> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to delete time.');
      }
      if (ids.length === 0) {
        return { results: [], deletedCount: 0 };
      }
      const idSet = new Set(ids);
      setDashboard((prev) =>
        prev
          ? {
              ...prev,
              recentEntries: prev.recentEntries.filter((e) => !idSet.has(e.id)),
            }
          : null
      );
      try {
        const token = await getValidToken();
        const res = await client.deleteTimesheets(token, ids);
        await loadDashboard();
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.deleteTimesheets(nextToken, ids);
          await loadDashboard();
          return res;
        }
        await loadDashboard();
        throw err;
      }
    },
    [client, controller, getValidToken, loadDashboard]
  );

  const listLeaves = useCallback(
    async (params?: { from?: string; to?: string }): Promise<LeaveRow[]> => {
      if (!client || !controller) return [];
      try {
        const token = await getValidToken();
        const res = await client.listLeaves(token, params);
        setIsOffline(false);
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.listLeaves(nextToken, params);
          setIsOffline(false);
          return res;
        }
        throw err;
      }
    },
    [client, controller, getValidToken]
  );

  const createLeave = useCallback(
    async (input: CreateLeaveInput): Promise<void> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to submit leaves.');
      }
      try {
        const token = await getValidToken();
        await client.createLeave(token, input);
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
    [client, controller, getValidToken]
  );

  const deleteLeave = useCallback(
    async (id: string): Promise<void> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to delete leaves.');
      }
      try {
        const token = await getValidToken();
        await client.deleteLeave(token, id);
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
    [client, controller, getValidToken]
  );

  const listReminders = useCallback(async (): Promise<ReminderItem[]> => {
    if (!client || !controller) return [];
    try {
      const token = await getValidToken();
      const res = await client.listReminders(token);
      setIsOffline(false);
      return res;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        const res = await client.listReminders(nextToken);
        setIsOffline(false);
        return res;
      }
      throw err;
    }
  }, [client, controller, getValidToken]);

  const createReminder = useCallback(
    async (input: CreateReminderInput): Promise<void> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to create reminders.');
      }
      try {
        const token = await getValidToken();
        await client.createReminder(token, input);
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
    [client, controller, getValidToken]
  );

  const updateReminder = useCallback(
    async (id: string, done: boolean): Promise<void> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to update reminders.');
      }
      try {
        const token = await getValidToken();
        await client.updateReminder(token, id, done);
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
    [client, controller, getValidToken]
  );

  const deleteReminder = useCallback(
    async (id: string): Promise<void> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to delete reminders.');
      }
      try {
        const token = await getValidToken();
        await client.deleteReminder(token, id);
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
    [client, controller, getValidToken]
  );

  const getReports = useCallback(
    async (params?: ReportParams): Promise<ReportTotals> => {
      if (!client || !controller) {
        return { totalHours: 0, totalEntries: 0, byGroup: [] };
      }
      try {
        const token = await getValidToken();
        const res = await client.getReports(token, params);
        setIsOffline(false);
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.getReports(nextToken, params);
          setIsOffline(false);
          return res;
        }
        throw err;
      }
    },
    [client, controller, getValidToken]
  );

  const listPeople = useCallback(async (): Promise<PersonProfile[]> => {
    if (!client || !controller) return [];
    try {
      const token = await getValidToken();
      const res = await client.listPeople(token);
      setIsOffline(false);
      return res;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        const res = await client.listPeople(nextToken);
        setIsOffline(false);
        return res;
      }
      throw err;
    }
  }, [client, controller, getValidToken]);

  const changePassword = useCallback(
    async (input: ChangePasswordInput): Promise<void> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to change password.');
      }
      try {
        const token = await getValidToken();
        await client.changePassword(token, input);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.changePassword(nextToken, input);
          return;
        }
        throw err;
      }
    },
    [client, controller, getValidToken]
  );

  const updateProfile = useCallback(
    async (input: UpdateProfileInput): Promise<MobileActor> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to update profile.');
      }
      try {
        const token = await getValidToken();
        const updated = await client.updateProfile(token, input);
        setActor(updated);
        return updated;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const updated = await client.updateProfile(nextToken, input);
          setActor(updated);
          return updated;
        }
        throw err;
      }
    },
    [client, controller, getValidToken]
  );

  const loadGlobalReminders = useCallback(async (): Promise<GlobalReminderItem[]> => {
    if (!client || !controller) return [];
    try {
      const token = await getValidToken();
      const data = await client.listGlobalReminders(token);
      setGlobalReminders(data);
      return data;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        const data = await client.listGlobalReminders(nextToken);
        setGlobalReminders(data);
        return data;
      }
      return [];
    }
  }, [client, controller, getValidToken]);

  const dismissGlobalReminder = useCallback(
    async (id: string): Promise<void> => {
      if (!client || !controller) return;
      const previous = globalReminders;
      setGlobalReminders((prev) => prev.filter((g) => g.id !== id));
      try {
        const token = await getValidToken();
        await client.dismissGlobalReminder(token, id);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.dismissGlobalReminder(nextToken, id);
          return;
        }
        setGlobalReminders(previous);
        throw err;
      }
    },
    [client, controller, getValidToken, globalReminders]
  );

  const loadLayout = useCallback(async (): Promise<MobileLayoutResponse | null> => {
    if (!client || !controller) return null;
    try {
      const token = await getValidToken();
      const res = await client.getLayout(token);
      setLayout(res.layout);
      return res;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        const res = await client.getLayout(nextToken);
        setLayout(res.layout);
        return res;
      }
      return null;
    }
  }, [client, controller, getValidToken]);

  const updateLayout = useCallback(
    async (newLayout: MobileLayout): Promise<void> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to update layout.');
      }
      try {
        const token = await getValidToken();
        const res = await client.updateLayout(newLayout, token);
        setLayout(res.layout);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.updateLayout(newLayout, nextToken);
          setLayout(res.layout);
          return;
        }
        throw err;
      }
    },
    [client, controller, getValidToken]
  );

  const resetLayout = useCallback(async (): Promise<void> => {
    if (!client || !controller) {
      throw new Error('You must be signed in to reset layout.');
    }
    try {
      const token = await getValidToken();
      const res = await client.resetLayout(token);
      setLayout(res.layout);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        const res = await client.resetLayout(nextToken);
        setLayout(res.layout);
        return;
      }
      throw err;
    }
  }, [client, controller, getValidToken]);

  const updateBranding = useCallback(
    async (newBranding: WorkspaceBranding): Promise<void> => {
      if (!client || !controller) {
        throw new Error('You must be signed in to update branding.');
      }
      try {
        const token = await getValidToken();
        const updated = await client.updateBranding(newBranding, token);
        setConfig((prev) => (prev ? { ...prev, branding: updated } : prev));
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const updated = await client.updateBranding(newBranding, nextToken);
          setConfig((prev) => (prev ? { ...prev, branding: updated } : prev));
          return;
        }
        throw err;
      }
    },
    [client, controller, getValidToken]
  );

  const resetBranding = useCallback(async (): Promise<void> => {
    if (!client || !controller) {
      throw new Error('You must be signed in to reset branding.');
    }
    try {
      const token = await getValidToken();
      const updated = await client.resetBranding(token);
      setConfig((prev) => (prev ? { ...prev, branding: updated } : prev));
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        const updated = await client.resetBranding(nextToken);
        setConfig((prev) => (prev ? { ...prev, branding: updated } : prev));
        return;
      }
      throw err;
    }
  }, [client, controller, getValidToken]);

  const listAdminProjects = useCallback(async (): Promise<ProjectAdminItem[]> => {
    if (!client || !controller) return [];
    try {
      const token = await getValidToken();
      return await client.listAdminProjects(token);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        return await client.listAdminProjects(nextToken);
      }
      throw err;
    }
  }, [client, controller, getValidToken]);

  const createAdminProject = useCallback(
    async (input: CreateProjectInput): Promise<ProjectAdminItem> => {
      if (!client || !controller) throw new Error('You must be signed in to create a project.');
      try {
        const token = await getValidToken();
        const res = await client.createAdminProject(input, token);
        await loadReference();
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.createAdminProject(input, nextToken);
          await loadReference();
          return res;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadReference]
  );

  const updateAdminProject = useCallback(
    async (id: string, input: UpdateProjectInput): Promise<ProjectAdminItem> => {
      if (!client || !controller) throw new Error('You must be signed in to update a project.');
      try {
        const token = await getValidToken();
        const res = await client.updateAdminProject(id, input, token);
        await loadReference();
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.updateAdminProject(id, input, nextToken);
          await loadReference();
          return res;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadReference]
  );

  const deleteAdminProject = useCallback(
    async (id: string): Promise<void> => {
      if (!client || !controller) throw new Error('You must be signed in to delete a project.');
      try {
        const token = await getValidToken();
        await client.deleteAdminProject(id, token);
        await loadReference();
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.deleteAdminProject(id, nextToken);
          await loadReference();
          return;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadReference]
  );

  const listAdminActivityTypes = useCallback(async (): Promise<ActivityTypeAdminItem[]> => {
    if (!client || !controller) return [];
    try {
      const token = await getValidToken();
      return await client.listAdminActivityTypes(token);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        return await client.listAdminActivityTypes(nextToken);
      }
      throw err;
    }
  }, [client, controller, getValidToken]);

  const createAdminActivityType = useCallback(
    async (input: CreateActivityTypeInput): Promise<ActivityTypeAdminItem> => {
      if (!client || !controller) throw new Error('You must be signed in to create an activity type.');
      try {
        const token = await getValidToken();
        const res = await client.createAdminActivityType(input, token);
        await loadReference();
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.createAdminActivityType(input, nextToken);
          await loadReference();
          return res;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadReference]
  );

  const updateAdminActivityType = useCallback(
    async (id: string, input: UpdateActivityTypeInput): Promise<ActivityTypeAdminItem> => {
      if (!client || !controller) throw new Error('You must be signed in to update an activity type.');
      try {
        const token = await getValidToken();
        const res = await client.updateAdminActivityType(id, input, token);
        await loadReference();
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.updateAdminActivityType(id, input, nextToken);
          await loadReference();
          return res;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadReference]
  );

  const deleteAdminActivityType = useCallback(
    async (id: string): Promise<void> => {
      if (!client || !controller) throw new Error('You must be signed in to delete an activity type.');
      try {
        const token = await getValidToken();
        await client.deleteAdminActivityType(id, token);
        await loadReference();
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.deleteAdminActivityType(id, nextToken);
          await loadReference();
          return;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadReference]
  );

  const listAdminUsers = useCallback(async (): Promise<PersonProfile[]> => {
    if (!client || !controller) return [];
    try {
      const token = await getValidToken();
      return await client.listAdminUsers(token);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        return await client.listAdminUsers(nextToken);
      }
      throw err;
    }
  }, [client, controller, getValidToken]);

  const createAdminUser = useCallback(
    async (input: CreateAdminUserInput): Promise<PersonProfile> => {
      if (!client || !controller) throw new Error('You must be signed in to create a user.');
      try {
        const token = await getValidToken();
        const res = await client.createAdminUser(input, token);
        await loadReference();
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.createAdminUser(input, nextToken);
          await loadReference();
          return res;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadReference]
  );

  const updateAdminUser = useCallback(
    async (id: string, input: UpdateAdminUserInput): Promise<PersonProfile> => {
      if (!client || !controller) throw new Error('You must be signed in to update a user.');
      try {
        const token = await getValidToken();
        const res = await client.updateAdminUser(id, input, token);
        await loadReference();
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.updateAdminUser(id, input, nextToken);
          await loadReference();
          return res;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadReference]
  );

  const listAdminTitles = useCallback(async (): Promise<TitleAdminItem[]> => {
    if (!client || !controller) return [];
    try {
      const token = await getValidToken();
      return await client.listAdminTitles(token);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        return await client.listAdminTitles(nextToken);
      }
      throw err;
    }
  }, [client, controller, getValidToken]);

  const createAdminTitle = useCallback(
    async (input: CreateTitleInput): Promise<TitleAdminItem> => {
      if (!client || !controller) throw new Error('You must be signed in to create a title.');
      try {
        const token = await getValidToken();
        const res = await client.createAdminTitle(input, token);
        await loadReference();
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.createAdminTitle(input, nextToken);
          await loadReference();
          return res;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadReference]
  );

  const reclassifyAdminTitle = useCallback(
    async (
      input: ReclassifyTitleInput
    ): Promise<{ name: string; hierarchyRole: string; affectedCount?: number }> => {
      if (!client || !controller) throw new Error('You must be signed in to reclassify a title.');
      try {
        const token = await getValidToken();
        const res = await client.reclassifyAdminTitle(input, token);
        await loadReference();
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.reclassifyAdminTitle(input, nextToken);
          await loadReference();
          return res;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadReference]
  );

  const deleteAdminTitle = useCallback(
    async (name: string): Promise<void> => {
      if (!client || !controller) throw new Error('You must be signed in to delete a title.');
      try {
        const token = await getValidToken();
        await client.deleteAdminTitle(name, token);
        await loadReference();
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.deleteAdminTitle(name, nextToken);
          await loadReference();
          return;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadReference]
  );

  const getBackfillSettings = useCallback(async (): Promise<BackfillSettings> => {
    if (!client || !controller) return { mode: 'days', windowDays: 7, extraDays: 0 };
    try {
      const token = await getValidToken();
      return await client.getBackfillSettings(token);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        return await client.getBackfillSettings(nextToken);
      }
      throw err;
    }
  }, [client, controller, getValidToken]);

  const updateBackfillSettings = useCallback(
    async (settings: BackfillSettings): Promise<BackfillSettings> => {
      if (!client || !controller) throw new Error('You must be signed in to update backfill settings.');
      try {
        const token = await getValidToken();
        const res = await client.updateBackfillSettings(settings, token);
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.updateBackfillSettings(settings, nextToken);
          return res;
        }
        throw err;
      }
    },
    [client, controller, getValidToken]
  );

  const listAdminLeaves = useCallback(
    async (params?: { userId?: string; from?: string; to?: string }): Promise<LeaveRow[]> => {
      if (!client || !controller) return [];
      try {
        const token = await getValidToken();
        return await client.listAdminLeaves(params, token);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          return await client.listAdminLeaves(params, nextToken);
        }
        throw err;
      }
    },
    [client, controller, getValidToken]
  );

  const createAdminLeave = useCallback(
    async (input: CreateAdminLeaveInput): Promise<void> => {
      if (!client || !controller) throw new Error('You must be signed in to create leave markers.');
      try {
        const token = await getValidToken();
        await client.createAdminLeave(input, token);
        await loadDashboard();
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.createAdminLeave(input, nextToken);
          await loadDashboard();
          return;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadDashboard]
  );

  const deleteAdminLeave = useCallback(
    async (id: string): Promise<void> => {
      if (!client || !controller) throw new Error('You must be signed in to delete leave markers.');
      try {
        const token = await getValidToken();
        await client.deleteAdminLeave(id, token);
        await loadDashboard();
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.deleteAdminLeave(id, nextToken);
          await loadDashboard();
          return;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadDashboard]
  );

  const listAllGlobalReminders = useCallback(async (): Promise<GlobalReminderItem[]> => {
    if (!client || !controller) return [];
    try {
      const token = await getValidToken();
      return await client.listAllGlobalReminders(token);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        const nextToken = await controller.refreshAccessToken();
        setAccessToken(nextToken);
        return await client.listAllGlobalReminders(nextToken);
      }
      throw err;
    }
  }, [client, controller, getValidToken]);

  const createAdminGlobalReminder = useCallback(
    async (input: CreateGlobalReminderInput): Promise<GlobalReminderItem> => {
      if (!client || !controller) throw new Error('You must be signed in to create global reminders.');
      try {
        const token = await getValidToken();
        const res = await client.createAdminGlobalReminder(input, token);
        await loadGlobalReminders();
        return res;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          const res = await client.createAdminGlobalReminder(input, nextToken);
          await loadGlobalReminders();
          return res;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadGlobalReminders]
  );

  const deleteAdminGlobalReminder = useCallback(
    async (id: string): Promise<void> => {
      if (!client || !controller) throw new Error('You must be signed in to delete global reminders.');
      try {
        const token = await getValidToken();
        await client.deleteAdminGlobalReminder(id, token);
        await loadGlobalReminders();
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          const nextToken = await controller.refreshAccessToken();
          setAccessToken(nextToken);
          await client.deleteAdminGlobalReminder(id, nextToken);
          await loadGlobalReminders();
          return;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, loadGlobalReminders]
  );

  const signup = useCallback(
    async (input: SignupInput): Promise<SignupResult> => {
      if (!client) throw new Error('Not connected to a workspace server.');
      return client.signup(input);
    },
    [client]
  );

  const queueMutation = useCallback(
    async (
      type: OfflineMutationType,
      payload: OfflineMutationPayload
    ): Promise<QueuedOfflineMutation> => {
      if (!serverUrl || !actor) {
        throw new Error('Cannot queue offline mutation without an active actor and server.');
      }
      const item = await offlineQueue.enqueue(serverUrl, actor.id, type, payload);
      const size = await offlineQueue.size(serverUrl, actor.id);
      setPendingCount(size);
      telemetry.log('offline_enqueue', { mutationId: item.id, type });
      return item;
    },
    [serverUrl, actor]
  );

  const flushQueue = useCallback(async (): Promise<SyncResult> => {
    if (!client || !serverUrl || !actor) {
      return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    }
    setIsSyncing(true);
    try {
      const token = await getValidToken();
      const result = await syncEngine.flush(client, serverUrl, actor.id, token);
      const size = await offlineQueue.size(serverUrl, actor.id);
      setPendingCount(size);
      if (result.succeeded > 0) {
        await loadDashboard();
      }
      return result;
    } finally {
      setIsSyncing(false);
    }
  }, [client, serverUrl, actor, getValidToken, loadDashboard]);

  useEffect(() => {
    if (serverUrl && actor) {
      offlineQueue.size(serverUrl, actor.id).then(setPendingCount);
    } else {
      setPendingCount(0);
    }
  }, [serverUrl, actor]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Boot restore lifecycle
  const bootAttemptedRef = React.useRef(false);
  useEffect(() => {
    if (bootAttemptedRef.current) return;
    bootAttemptedRef.current = true;
    let mounted = true;

    async function init() {
      const targetUrl = initialServerUrl || (await workspaceStore.get());
      if (targetUrl) {
        try {
          await connectServer(targetUrl);
        } catch {
          if (mounted) setStatus('disconnected');
        }
      } else {
        if (mounted) setStatus('disconnected');
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, [initialServerUrl, connectServer]);

  const effectiveActor = useMemo(() => actor || dashboard?.actor || null, [actor, dashboard?.actor]);
  const branding = useMemo(() => config?.branding ?? DEFAULT_BRANDING, [config?.branding]);

  const statusValue: SessionStatusContextValue = useMemo(
    () => ({
      status,
      actor,
      effectiveActor,
      serverUrl,
      config,
      branding,
      error,
      clearError,
      checkStatus,
    }),
    [status, actor, effectiveActor, serverUrl, config, branding, error, clearError, checkStatus]
  );

  const syncValue: SessionSyncContextValue = useMemo(
    () => ({
      isOffline,
      pendingCount,
      isSyncing,
      flushQueue,
      queueMutation,
    }),
    [isOffline, pendingCount, isSyncing, flushQueue, queueMutation]
  );

  const dataValue: SessionDataContextValue = useMemo(
    () => ({
      dashboard,
      reference,
      globalReminders,
      layout,
      loadDashboard,
      loadReference,
      loadGlobalReminders,
      dismissGlobalReminder,
      loadLayout,
    }),
    [dashboard, reference, globalReminders, layout, loadDashboard, loadReference, loadGlobalReminders, dismissGlobalReminder, loadLayout]
  );

  const actionsValue: SessionActionsContextValue = useMemo(
    () => ({
      connectServer,
      signIn,
      signup,
      signOut,
      logoutAll,
      disconnectServer,
      updateBranding,
      resetBranding,
      updateLayout,
      resetLayout,
      updateProfile,
      listTimesheets,
      createTimesheet,
      updateTimesheet,
      deleteTimesheet,
      deleteTimesheets,
      duplicateTimesheet,
      duplicateTimesheets,
      listLeaves,
      createLeave,
      deleteLeave,
      listReminders,
      createReminder,
      updateReminder,
      deleteReminder,
      getReports,
      listPeople,
      changePassword,
      listAdminProjects,
      createAdminProject,
      updateAdminProject,
      deleteAdminProject,
      listAdminActivityTypes,
      createAdminActivityType,
      updateAdminActivityType,
      deleteAdminActivityType,
      listAdminUsers,
      createAdminUser,
      updateAdminUser,
      listAdminTitles,
      createAdminTitle,
      reclassifyAdminTitle,
      deleteAdminTitle,
      getBackfillSettings,
      updateBackfillSettings,
      listAdminLeaves,
      createAdminLeave,
      deleteAdminLeave,
      listAllGlobalReminders,
      createAdminGlobalReminder,
      deleteAdminGlobalReminder,
    }),
    [
      connectServer,
      signIn,
      signup,
      signOut,
      logoutAll,
      disconnectServer,
      updateBranding,
      resetBranding,
      updateLayout,
      resetLayout,
      updateProfile,
      listTimesheets,
      createTimesheet,
      updateTimesheet,
      deleteTimesheet,
      deleteTimesheets,
      duplicateTimesheet,
      duplicateTimesheets,
      listLeaves,
      createLeave,
      deleteLeave,
      listReminders,
      createReminder,
      updateReminder,
      deleteReminder,
      getReports,
      listPeople,
      changePassword,
      listAdminProjects,
      createAdminProject,
      updateAdminProject,
      deleteAdminProject,
      listAdminActivityTypes,
      createAdminActivityType,
      updateAdminActivityType,
      deleteAdminActivityType,
      listAdminUsers,
      createAdminUser,
      updateAdminUser,
      listAdminTitles,
      createAdminTitle,
      reclassifyAdminTitle,
      deleteAdminTitle,
      getBackfillSettings,
      updateBackfillSettings,
      listAdminLeaves,
      createAdminLeave,
      deleteAdminLeave,
      listAllGlobalReminders,
      createAdminGlobalReminder,
      deleteAdminGlobalReminder,
    ]
  );

  const contextValue: SessionContextValue = useMemo(
    () => ({
      status,
      actor,
      effectiveActor,
      serverUrl,
      config,
      branding,
      error,
      dashboard,
      reference,
      globalReminders,
      layout,
      isOffline,
      pendingCount,
      isSyncing,
      flushQueue,
      queueMutation,
      connectServer,
      signIn,
      signup,
      signOut,
      logoutAll,
      disconnectServer,
      updateBranding,
      resetBranding,
      loadDashboard,
      loadReference,
      loadGlobalReminders,
      dismissGlobalReminder,
      loadLayout,
      updateLayout,
      resetLayout,
      updateProfile,
      listTimesheets,
      createTimesheet,
      updateTimesheet,
      deleteTimesheet,
      deleteTimesheets,
      duplicateTimesheet,
      duplicateTimesheets,
      listLeaves,
      createLeave,
      deleteLeave,
      listReminders,
      createReminder,
      updateReminder,
      deleteReminder,
      getReports,
      listPeople,
      changePassword,
      listAdminProjects,
      createAdminProject,
      updateAdminProject,
      deleteAdminProject,
      listAdminActivityTypes,
      createAdminActivityType,
      updateAdminActivityType,
      deleteAdminActivityType,
      listAdminUsers,
      createAdminUser,
      updateAdminUser,
      listAdminTitles,
      createAdminTitle,
      reclassifyAdminTitle,
      deleteAdminTitle,
      getBackfillSettings,
      updateBackfillSettings,
      listAdminLeaves,
      createAdminLeave,
      deleteAdminLeave,
      listAllGlobalReminders,
      createAdminGlobalReminder,
      deleteAdminGlobalReminder,
      checkStatus,
      clearError,
    }),
    [
      status,
      actor,
      effectiveActor,
      serverUrl,
      config,
      branding,
      error,
      dashboard,
      reference,
      globalReminders,
      layout,
      isOffline,
      pendingCount,
      isSyncing,
      flushQueue,
      queueMutation,
      connectServer,
      signIn,
      signup,
      signOut,
      logoutAll,
      disconnectServer,
      updateBranding,
      resetBranding,
      loadDashboard,
      loadReference,
      loadGlobalReminders,
      dismissGlobalReminder,
      loadLayout,
      updateLayout,
      resetLayout,
      updateProfile,
      listTimesheets,
      createTimesheet,
      updateTimesheet,
      deleteTimesheet,
      deleteTimesheets,
      duplicateTimesheet,
      duplicateTimesheets,
      listLeaves,
      createLeave,
      deleteLeave,
      listReminders,
      createReminder,
      updateReminder,
      deleteReminder,
      getReports,
      listPeople,
      changePassword,
      listAdminProjects,
      createAdminProject,
      updateAdminProject,
      deleteAdminProject,
      listAdminActivityTypes,
      createAdminActivityType,
      updateAdminActivityType,
      deleteAdminActivityType,
      listAdminUsers,
      createAdminUser,
      updateAdminUser,
      listAdminTitles,
      createAdminTitle,
      reclassifyAdminTitle,
      deleteAdminTitle,
      getBackfillSettings,
      updateBackfillSettings,
      listAdminLeaves,
      createAdminLeave,
      deleteAdminLeave,
      listAllGlobalReminders,
      createAdminGlobalReminder,
      deleteAdminGlobalReminder,
      checkStatus,
      clearError,
    ]
  );

  return (
    <SessionStatusContext.Provider value={statusValue}>
      <SessionSyncContext.Provider value={syncValue}>
        <SessionDataContext.Provider value={dataValue}>
          <SessionActionsContext.Provider value={actionsValue}>
            <SessionContext.Provider value={contextValue}>{children}</SessionContext.Provider>
          </SessionActionsContext.Provider>
        </SessionDataContext.Provider>
      </SessionSyncContext.Provider>
    </SessionStatusContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider.');
  }
  return context;
}

export function useSessionStatus(): SessionStatusContextValue {
  const context = useContext(SessionStatusContext);
  if (!context) {
    throw new Error('useSessionStatus must be used within a SessionProvider.');
  }
  return context;
}

export function useSessionActor() {
  const { actor, effectiveActor, serverUrl, config } = useSessionStatus();
  return { actor, effectiveActor, serverUrl, config };
}

export function useSessionSync(): SessionSyncContextValue {
  const context = useContext(SessionSyncContext);
  if (!context) {
    throw new Error('useSessionSync must be used within a SessionProvider.');
  }
  return context;
}

export function useSessionData(): SessionDataContextValue {
  const context = useContext(SessionDataContext);
  if (!context) {
    throw new Error('useSessionData must be used within a SessionProvider.');
  }
  return context;
}

export function useSessionDashboard() {
  const { dashboard, loadDashboard } = useSessionData();
  return { dashboard, loadDashboard };
}

export function useSessionReference() {
  const { reference, loadReference } = useSessionData();
  return { reference, loadReference };
}

export function useSessionActions(): SessionActionsContextValue {
  const context = useContext(SessionActionsContext);
  if (!context) {
    throw new Error('useSessionActions must be used within a SessionProvider.');
  }
  return context;
}
