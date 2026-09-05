import { NativeModules } from 'react-native';

export const DISCONNECTED_SENTINEL = '__DISCONNECTED__';

interface GlobalProcess {
  env?: Record<string, string | undefined>;
}

interface NodeFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
  writeFileSync(path: string, data: string, encoding: string): void;
  unlinkSync(path: string): void;
}

interface GlobalScope {
  localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  process?: GlobalProcess;
  require?: (module: string) => unknown;
}

function getGlobalScope(): GlobalScope {
  return globalThis as unknown as GlobalScope;
}

interface NativeWorkspaceModule {
  readWorkspace?: () => Promise<string | null>;
  writeWorkspace?: (url: string) => Promise<void>;
  clearWorkspace?: () => Promise<void>;
}

function getNativeStorage(): NativeWorkspaceModule | null {
  try {
    const modules = NativeModules as unknown as Record<string, unknown>;
    return (modules?.VsisSecureStorage as NativeWorkspaceModule) || null;
  } catch {
    return null;
  }
}

function getNodeFs(): NodeFs | null {
  try {
    const scope = getGlobalScope();
    if (typeof scope.require === 'function') {
      return scope.require('fs') as NodeFs;
    }
  } catch {
    // Ignore require errors
  }
  return null;
}

function getWorkspaceStoragePath(): string | null {
  const scope = getGlobalScope();
  const env = scope.process?.env;
  if (!env) return null;
  const appData = env.LOCALAPPDATA || env.APPDATA || env.HOME;
  if (!appData) return null;
  return `${appData}/vsis-timesheet-workspace.json`;
}

export function validateWorkspaceUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === DISCONNECTED_SENTINEL) return null;

  try {
    const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    // Reject any credentials (username or password embedded in URL)
    if (url.username || url.password) {
      return null;
    }
    // Strip trailing slash
    const normalized = `${url.origin}${url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')}`;
    return normalized;
  } catch {
    return null;
  }
}

export function getBuildTimeDefaultWorkspaceUrl(): string | null {
  const scope = getGlobalScope();
  const env = scope.process?.env || {};
  const candidate =
    env.EXPO_PUBLIC_DEFAULT_WORKSPACE_URL ||
    env.NEXT_PUBLIC_DEFAULT_WORKSPACE_URL ||
    env.DEFAULT_WORKSPACE_URL;
  return validateWorkspaceUrl(candidate);
}

export class WorkspaceStore {
  private inMemory: string | null = null;
  private readonly storageKey = 'vsis_timesheet_workspace_url';

  async get(): Promise<string | null> {
    if (this.inMemory === DISCONNECTED_SENTINEL) return null;
    if (this.inMemory) return this.inMemory;

    // 1. Try NativeModules.VsisSecureStorage (Windows PasswordVault, Android SharedPreferences, iOS Keychain)
    try {
      const nativeStorage = getNativeStorage();
      if (nativeStorage && typeof nativeStorage.readWorkspace === 'function') {
        const raw = await nativeStorage.readWorkspace();
        if (raw === DISCONNECTED_SENTINEL) {
          this.inMemory = DISCONNECTED_SENTINEL;
          return null;
        }
        const validated = validateWorkspaceUrl(raw);
        if (validated) {
          this.inMemory = validated;
          return this.inMemory;
        }
      }
    } catch {
      // Ignore native module read errors
    }

    // 2. Try localStorage (web / test)
    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        const raw = scope.localStorage.getItem(this.storageKey);
        if (raw === DISCONNECTED_SENTINEL) {
          this.inMemory = DISCONNECTED_SENTINEL;
          return null;
        }
        const validated = validateWorkspaceUrl(raw);
        if (validated) {
          this.inMemory = validated;
          return this.inMemory;
        }
      }
    } catch {
      // Ignore localStorage read errors
    }

    // 3. Try Node/Windows file storage (Node/CLI fallback)
    try {
      const storagePath = getWorkspaceStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs && fs.existsSync(storagePath)) {
        const raw = fs.readFileSync(storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.serverUrl === DISCONNECTED_SENTINEL) {
          this.inMemory = DISCONNECTED_SENTINEL;
          return null;
        }
        const validated = validateWorkspaceUrl(parsed?.serverUrl);
        if (validated) {
          this.inMemory = validated;
          return this.inMemory;
        }
      }
    } catch {
      // Ignore file storage read errors
    }

    // 4. Fallback to build-time default workspace URL if unconfigured
    const buildTimeDefault = getBuildTimeDefaultWorkspaceUrl();
    if (buildTimeDefault) {
      return buildTimeDefault;
    }

    return null;
  }

  async set(serverUrl: string): Promise<void> {
    const trimmed = (serverUrl || '').trim();
    if (!trimmed) {
      return this.clear();
    }

    const validated = validateWorkspaceUrl(trimmed) || trimmed;
    this.inMemory = validated;

    // 1. Try NativeModules.VsisSecureStorage
    try {
      const nativeStorage = getNativeStorage();
      if (nativeStorage && typeof nativeStorage.writeWorkspace === 'function') {
        await nativeStorage.writeWorkspace(validated);
      }
    } catch {
      // Ignore native module write errors
    }

    // 2. Try localStorage
    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        scope.localStorage.setItem(this.storageKey, validated);
      }
    } catch {
      // Ignore localStorage write errors
    }

    // 3. Try Node/Windows file storage
    try {
      const storagePath = getWorkspaceStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs) {
        fs.writeFileSync(storagePath, JSON.stringify({ serverUrl: validated }), 'utf8');
      }
    } catch {
      // Ignore file storage write errors
    }
  }

  async clear(): Promise<void> {
    this.inMemory = DISCONNECTED_SENTINEL;

    // 1. Try NativeModules.VsisSecureStorage
    try {
      const nativeStorage = getNativeStorage();
      if (nativeStorage && typeof nativeStorage.writeWorkspace === 'function') {
        await nativeStorage.writeWorkspace(DISCONNECTED_SENTINEL);
      }
    } catch {
      // Ignore native clear errors
    }

    // 2. Try localStorage
    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        scope.localStorage.setItem(this.storageKey, DISCONNECTED_SENTINEL);
      }
    } catch {
      // Ignore localStorage clear errors
    }

    // 3. Try Node/Windows file storage
    try {
      const storagePath = getWorkspaceStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs) {
        fs.writeFileSync(storagePath, JSON.stringify({ serverUrl: DISCONNECTED_SENTINEL }), 'utf8');
      }
    } catch {
      // Ignore file storage write errors
    }
  }

  async reset(): Promise<void> {
    this.inMemory = null;

    // 1. Try NativeModules.VsisSecureStorage
    try {
      const nativeStorage = getNativeStorage();
      if (nativeStorage && typeof nativeStorage.clearWorkspace === 'function') {
        await nativeStorage.clearWorkspace();
      }
    } catch {
      // Ignore native reset errors
    }

    // 2. Try localStorage
    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        scope.localStorage.removeItem(this.storageKey);
      }
    } catch {
      // Ignore
    }

    // 3. Try Node/Windows file storage
    try {
      const storagePath = getWorkspaceStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs && fs.existsSync(storagePath)) {
        fs.unlinkSync(storagePath);
      }
    } catch {
      // Ignore
    }
  }
}

export const workspaceStore = new WorkspaceStore();
