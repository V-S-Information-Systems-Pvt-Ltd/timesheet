import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  TitleImpactInfo,
  BackfillSettings,
  CreateAdminLeaveInput,
  CreateGlobalReminderInput,
} from '../api/contracts';
import { DEFAULT_BRANDING } from '../api/contracts';
import { DEFAULT_MOBILE_LAYOUT } from '../navigation/modules';
import { SessionController, type SessionState } from './session-controller';
import { createTokenStore, type SecureTokenStore } from '../platform/secure-storage';
import { SecureStorageError } from '../platform/secure-storage/types';
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
import type { ReportExportOutcome } from '../services/reportFileExport';
import type { WithAuth } from './domains/types';
import { createTimesheetsActions } from './domains/timesheets';
import { createLeavesActions } from './domains/leaves';
import { createRemindersActions } from './domains/reminders';
import { createAdminReferenceActions } from './domains/admin-reference';
import { createSettingsLayoutActions } from './domains/settings-layout';
import { createReportsActions } from './domains/reports';

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
  loadAdminDefaultLayout: () => Promise<MobileLayout>;
  updateAdminDefaultLayout: (layout: MobileLayout) => Promise<MobileLayout>;
  resetAdminDefaultLayout: () => Promise<MobileLayout>;
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
  exportReportsFile: (params?: ReportParams, options?: { signal?: AbortSignal }) => Promise<ReportExportOutcome>;
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
  getAdminTitleImpact: (name: string, proposedRole: string) => Promise<TitleImpactInfo>;
  reclassifyAdminTitle: (input: ReclassifyTitleInput) => Promise<{ name: string; hierarchyRole: string; affectedCount?: number }>;
  deleteAdminTitle: (name: string) => Promise<void>;
  getBackfillSettings: () => Promise<BackfillSettings>;
  updateBackfillSettings: (settings: BackfillSettings) => Promise<BackfillSettings>;
  listAdminLeaves: (params?: { userId?: string; from?: string; to?: string }) => Promise<LeaveRow[]>;
  createAdminLeave: (input: CreateAdminLeaveInput) => Promise<void>;
  deleteAdminLeave: (id: string) => Promise<void>;
  listAllGlobalReminders: () => Promise<GlobalReminderItem[]>;
  createAdminGlobalReminder: (input: CreateGlobalReminderInput) => Promise<GlobalReminderItem>;
  updateAdminGlobalReminder: (id: string, input: Partial<CreateGlobalReminderInput>) => Promise<{ success: boolean; id: string }>;
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
  | 'loadAdminDefaultLayout'
  | 'updateAdminDefaultLayout'
  | 'resetAdminDefaultLayout'
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
  | 'exportReportsFile'
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
  | 'getAdminTitleImpact'
  | 'reclassifyAdminTitle'
  | 'deleteAdminTitle'
  | 'getBackfillSettings'
  | 'updateBackfillSettings'
  | 'listAdminLeaves'
  | 'createAdminLeave'
  | 'deleteAdminLeave'
  | 'listAllGlobalReminders'
  | 'createAdminGlobalReminder'
  | 'updateAdminGlobalReminder'
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

  const serverUrlRef = useRef<string | null>(serverUrl);
  serverUrlRef.current = serverUrl;
  const actorRef = useRef<MobileActor | null>(actor);
  actorRef.current = actor;
  const inFlightReferencePromiseRef = useRef<Promise<MobileReferenceData | null> | null>(null);

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
        setActor(null);
        setAccessToken(null);
        setIsOffline(false);
        setDashboard(null);
        setReference(null);
        setGlobalReminders([]);
        setError(state.message);
        break;
      case 'signed-out':
      default:
        setStatus('signed-out');
        setActor(null);
        setAccessToken(null);
        setDashboard(null);
        setReference(null);
        setIsOffline(false);
        setError(null);
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
      applyControllerState(controller.getState());
    }
    dashboardCache.clear(serverUrl ?? undefined, actor?.id ?? undefined);
  }, [controller, applyControllerState, serverUrl, actor]);

  const logoutAll = useCallback(async (): Promise<void> => {
    if (controller) {
      await controller.logoutAll();
      applyControllerState(controller.getState());
    }
    dashboardCache.clear(serverUrl ?? undefined, actor?.id ?? undefined);
  }, [controller, applyControllerState, serverUrl, actor]);

  const disconnectServer = useCallback(async (): Promise<void> => {
    await signOut();
    await workspaceStore.clear();
    if (controller?.getState().status === 'error') {
      setServerUrl(null);
      setConfig(null);
      return;
    }
    setServerUrl(null);
    setConfig(null);
    setStatus('disconnected');
  }, [signOut, controller]);

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
      if (err instanceof SecureStorageError || controller.getState().status === 'error') {
        applyControllerState(controller.getState());
      } else if (!isOffline) {
        setIsOffline(true);
      }
      throw err;
    }
  }, [client, controller, accessToken, isOffline, applyControllerState]);

  // Central authenticated API invoker leveraging ApiClient single-flight 401 retry
  const withAuth: WithAuth = useCallback(
    async <T,>(
      fn: (apiClient: ApiClient, token: string) => Promise<T>,
      options?: { defaultValue?: T; errorMessage?: string }
    ): Promise<T> => {
      if (!client || !controller) {
        if (options?.defaultValue !== undefined) return options.defaultValue;
        throw new Error(options?.errorMessage ?? 'Not connected to a workspace.');
      }
      try {
        const token = await getValidToken();
        const result = await fn(client, token);
        setIsOffline(false);
        return result;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          // Token refresh was already attempted by ApiClient single-flight handler.
          // If we still receive 401, session is invalid or revoked -> sign out.
          await signOut();
        }
        if (options?.defaultValue !== undefined) {
          return options.defaultValue;
        }
        throw err;
      }
    },
    [client, controller, getValidToken, signOut]
  );

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
          await signOut();
        }
        return null;
      } finally {
        inFlightReferencePromiseRef.current = null;
      }
    })();

    inFlightReferencePromiseRef.current = fetchPromise;
    return fetchPromise;
  }, [client, controller, getValidToken, signOut]);

  // Domain action hooks/creators
  const timesheetActions = useMemo(
    () => createTimesheetsActions(withAuth, { loadDashboard, setDashboard }),
    [withAuth, loadDashboard]
  );

  const leaveActions = useMemo(
    () => createLeavesActions(withAuth, { loadDashboard }),
    [withAuth, loadDashboard]
  );

  const reminderActions = useMemo(
    () =>
      createRemindersActions(withAuth, {
        setGlobalReminders,
        loadGlobalReminders: async () => {
          const data = await withAuth((c, token) => c.listGlobalReminders(token), { defaultValue: [] });
          setGlobalReminders(data);
          return data;
        },
      }),
    [withAuth]
  );

  const adminReferenceActions = useMemo(
    () => createAdminReferenceActions(withAuth, { loadReference }),
    [withAuth, loadReference]
  );

  const settingsLayoutActions = useMemo(
    () => createSettingsLayoutActions(withAuth, { setLayout, setConfig }),
    [withAuth]
  );

  const reportActions = useMemo(
    () =>
      createReportsActions(withAuth, {
        client,
        controller,
        getValidToken,
        setAccessToken,
        setActor,
      }),
    [withAuth, client, controller, getValidToken]
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
  const bootAttemptedRef = useRef(false);
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
      loadGlobalReminders: reminderActions.loadGlobalReminders,
      dismissGlobalReminder: reminderActions.dismissGlobalReminder,
      loadLayout: settingsLayoutActions.loadLayout,
    }),
    [
      dashboard,
      reference,
      globalReminders,
      layout,
      loadDashboard,
      loadReference,
      reminderActions.loadGlobalReminders,
      reminderActions.dismissGlobalReminder,
      settingsLayoutActions.loadLayout,
    ]
  );

  const actionsValue: SessionActionsContextValue = useMemo(
    () => ({
      connectServer,
      signIn,
      signup,
      signOut,
      logoutAll,
      disconnectServer,
      updateBranding: settingsLayoutActions.updateBranding,
      resetBranding: settingsLayoutActions.resetBranding,
      updateLayout: settingsLayoutActions.updateLayout,
      resetLayout: settingsLayoutActions.resetLayout,
      loadAdminDefaultLayout: settingsLayoutActions.loadAdminDefaultLayout,
      updateAdminDefaultLayout: settingsLayoutActions.updateAdminDefaultLayout,
      resetAdminDefaultLayout: settingsLayoutActions.resetAdminDefaultLayout,
      updateProfile: reportActions.updateProfile,
      listTimesheets: timesheetActions.listTimesheets,
      createTimesheet: timesheetActions.createTimesheet,
      updateTimesheet: timesheetActions.updateTimesheet,
      deleteTimesheet: timesheetActions.deleteTimesheet,
      deleteTimesheets: timesheetActions.deleteTimesheets,
      duplicateTimesheet: timesheetActions.duplicateTimesheet,
      duplicateTimesheets: timesheetActions.duplicateTimesheets,
      listLeaves: leaveActions.listLeaves,
      createLeave: leaveActions.createLeave,
      deleteLeave: leaveActions.deleteLeave,
      listReminders: reminderActions.listReminders,
      createReminder: reminderActions.createReminder,
      updateReminder: reminderActions.updateReminder,
      deleteReminder: reminderActions.deleteReminder,
      getReports: reportActions.getReports,
      exportReportsFile: reportActions.exportReportsFile,
      listPeople: reportActions.listPeople,
      changePassword: reportActions.changePassword,
      listAdminProjects: adminReferenceActions.listAdminProjects,
      createAdminProject: adminReferenceActions.createAdminProject,
      updateAdminProject: adminReferenceActions.updateAdminProject,
      deleteAdminProject: adminReferenceActions.deleteAdminProject,
      listAdminActivityTypes: adminReferenceActions.listAdminActivityTypes,
      createAdminActivityType: adminReferenceActions.createAdminActivityType,
      updateAdminActivityType: adminReferenceActions.updateAdminActivityType,
      deleteAdminActivityType: adminReferenceActions.deleteAdminActivityType,
      listAdminUsers: adminReferenceActions.listAdminUsers,
      createAdminUser: adminReferenceActions.createAdminUser,
      updateAdminUser: adminReferenceActions.updateAdminUser,
      listAdminTitles: adminReferenceActions.listAdminTitles,
      createAdminTitle: adminReferenceActions.createAdminTitle,
      getAdminTitleImpact: adminReferenceActions.getAdminTitleImpact,
      reclassifyAdminTitle: adminReferenceActions.reclassifyAdminTitle,
      deleteAdminTitle: adminReferenceActions.deleteAdminTitle,
      getBackfillSettings: adminReferenceActions.getBackfillSettings,
      updateBackfillSettings: adminReferenceActions.updateBackfillSettings,
      listAdminLeaves: leaveActions.listAdminLeaves,
      createAdminLeave: leaveActions.createAdminLeave,
      deleteAdminLeave: leaveActions.deleteAdminLeave,
      listAllGlobalReminders: reminderActions.listAllGlobalReminders,
      createAdminGlobalReminder: reminderActions.createAdminGlobalReminder,
      updateAdminGlobalReminder: reminderActions.updateAdminGlobalReminder,
      deleteAdminGlobalReminder: reminderActions.deleteAdminGlobalReminder,
    }),
    [
      connectServer,
      signIn,
      signup,
      signOut,
      logoutAll,
      disconnectServer,
      settingsLayoutActions,
      reportActions,
      timesheetActions,
      leaveActions,
      reminderActions,
      adminReferenceActions,
    ]
  );

  const contextValue: SessionContextValue = useMemo(
    () => ({
      ...statusValue,
      ...syncValue,
      ...dataValue,
      ...actionsValue,
    }),
    [statusValue, syncValue, dataValue, actionsValue]
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
