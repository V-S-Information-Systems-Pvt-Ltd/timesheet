export type ThemePreference = 'system' | 'light' | 'dark';

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

function getThemeStoragePath(): string | null {
  const scope = getGlobalScope();
  const env = scope.process?.env;
  if (!env) return null;
  const appData = env.LOCALAPPDATA || env.APPDATA || env.HOME;
  if (!appData) return null;
  return `${appData}/vsis-timesheet-theme.json`;
}

export class ThemeStore {
  private inMemory: ThemePreference = 'system';
  private readonly storageKey = 'vsis_timesheet_theme_preference';

  getInitialSync(): ThemePreference {
    // 1. Try localStorage
    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        const raw = scope.localStorage.getItem(this.storageKey);
        if (raw === 'system' || raw === 'light' || raw === 'dark') {
          this.inMemory = raw;
          return raw;
        }
      }
    } catch {
      // Ignore
    }

    // 2. Try Node/Windows file storage
    try {
      const storagePath = getThemeStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs && fs.existsSync(storagePath)) {
        const raw = fs.readFileSync(storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.theme === 'system' || parsed?.theme === 'light' || parsed?.theme === 'dark') {
          this.inMemory = parsed.theme;
          return parsed.theme;
        }
      }
    } catch {
      // Ignore
    }

    return this.inMemory;
  }

  async get(): Promise<ThemePreference> {
    return this.getInitialSync();
  }

  async set(preference: ThemePreference): Promise<void> {
    if (preference !== 'system' && preference !== 'light' && preference !== 'dark') {
      return;
    }
    this.inMemory = preference;

    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        scope.localStorage.setItem(this.storageKey, preference);
      }
    } catch {
      // Ignore
    }

    try {
      const storagePath = getThemeStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs) {
        fs.writeFileSync(storagePath, JSON.stringify({ theme: preference }), 'utf8');
      }
    } catch {
      // Ignore
    }
  }

  async clear(): Promise<void> {
    this.inMemory = 'system';
    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        scope.localStorage.removeItem(this.storageKey);
      }
    } catch {
      // Ignore
    }
    try {
      const storagePath = getThemeStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs && fs.existsSync(storagePath)) {
        fs.unlinkSync(storagePath);
      }
    } catch {
      // Ignore
    }
  }
}

export const themeStore = new ThemeStore();
