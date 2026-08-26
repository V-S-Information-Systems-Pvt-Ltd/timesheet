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

export class WorkspaceStore {
  private inMemory: string | null = null;
  private readonly storageKey = 'vsis_timesheet_workspace_url';

  async get(): Promise<string | null> {
    if (this.inMemory) return this.inMemory;

    // 1. Try localStorage
    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        const raw = scope.localStorage.getItem(this.storageKey);
        if (raw && typeof raw === 'string' && raw.trim().length > 0) {
          this.inMemory = raw.trim();
          return this.inMemory;
        }
      }
    } catch {
      // Ignore localStorage read errors
    }

    // 2. Try Node/Windows file storage
    try {
      const storagePath = getWorkspaceStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs && fs.existsSync(storagePath)) {
        const raw = fs.readFileSync(storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.serverUrl === 'string' && parsed.serverUrl.trim().length > 0) {
          this.inMemory = parsed.serverUrl.trim();
          return this.inMemory;
        }
      }
    } catch {
      // Ignore file storage read errors
    }

    return null;
  }

  async set(serverUrl: string): Promise<void> {
    const trimmed = serverUrl.trim();
    this.inMemory = trimmed;

    // 1. Try localStorage
    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        scope.localStorage.setItem(this.storageKey, trimmed);
      }
    } catch {
      // Ignore localStorage write errors
    }

    // 2. Try Node/Windows file storage
    try {
      const storagePath = getWorkspaceStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs) {
        fs.writeFileSync(storagePath, JSON.stringify({ serverUrl: trimmed }), 'utf8');
      }
    } catch {
      // Ignore file storage write errors
    }
  }

  async clear(): Promise<void> {
    this.inMemory = null;

    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        scope.localStorage.removeItem(this.storageKey);
      }
    } catch {
      // Ignore localStorage clear errors
    }

    try {
      const storagePath = getWorkspaceStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs && fs.existsSync(storagePath)) {
        fs.unlinkSync(storagePath);
      }
    } catch {
      // Ignore file storage unlink errors
    }
  }
}

export const workspaceStore = new WorkspaceStore();
