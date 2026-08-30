import type { SecureTokenStore, StoredTokens } from './types';

interface GlobalProcess {
  env?: Record<string, string | undefined>;
}

interface NodeFsPromises {
  readFile(path: string, encoding: string): Promise<string>;
  writeFile(path: string, data: string, encoding: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

interface NodeFs {
  promises?: NodeFsPromises;
  readFile?(path: string, encoding: string, cb: (err: unknown, data: string) => void): void;
  writeFile?(path: string, data: string, encoding: string, cb: (err: unknown) => void): void;
  unlink?(path: string, cb: (err: unknown) => void): void;
  existsSync?(path: string): boolean;
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

function getStoragePath(): string | null {
  const scope = getGlobalScope();
  const env = scope.process?.env;
  if (!env) return null;
  const appData = env.LOCALAPPDATA || env.APPDATA || env.HOME;
  if (!appData) return null;
  return `${appData}/vsis-timesheet-tokens.json`;
}

async function asyncReadFile(fs: NodeFs, filePath: string): Promise<string | null> {
  if (fs.promises?.readFile) {
    try {
      return await fs.promises.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  }
  return new Promise((resolve) => {
    if (typeof fs.readFile === 'function') {
      fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) resolve(null);
        else resolve(data);
      });
    } else {
      resolve(null);
    }
  });
}

async function asyncWriteFile(fs: NodeFs, filePath: string, content: string): Promise<void> {
  if (fs.promises?.writeFile) {
    try {
      await fs.promises.writeFile(filePath, content, 'utf8');
    } catch {
      // Ignore write errors
    }
    return;
  }
  return new Promise((resolve) => {
    if (typeof fs.writeFile === 'function') {
      fs.writeFile(filePath, content, 'utf8', () => resolve());
    } else {
      resolve();
    }
  });
}

async function asyncUnlink(fs: NodeFs, filePath: string): Promise<void> {
  if (fs.promises?.unlink) {
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // Ignore unlink errors
    }
    return;
  }
  return new Promise((resolve) => {
    if (typeof fs.unlink === 'function') {
      fs.unlink(filePath, () => resolve());
    } else {
      resolve();
    }
  });
}

export class DurableTokenStore implements SecureTokenStore {
  private inMemory: StoredTokens | null = null;
  private readonly storageKey = 'vsis_timesheet_secure_tokens';

  async read(): Promise<StoredTokens | null> {
    if (this.inMemory) return { ...this.inMemory };

    // 1. Try localStorage if available
    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        const raw = scope.localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (
            parsed &&
            typeof parsed === 'object' &&
            typeof parsed.refreshToken === 'string' &&
            typeof parsed.sessionId === 'string'
          ) {
            const tokens: StoredTokens = {
              refreshToken: parsed.refreshToken,
              sessionId: parsed.sessionId,
            };
            this.inMemory = tokens;
            return { ...this.inMemory };
          }
        }
      }
    } catch {
      // Ignore localStorage read errors
    }

    // 2. Try Node/Windows async file storage if available
    try {
      const storagePath = getStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs) {
        const raw = await asyncReadFile(fs, storagePath);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (
            parsed &&
            typeof parsed === 'object' &&
            typeof parsed.refreshToken === 'string' &&
            typeof parsed.sessionId === 'string'
          ) {
            const tokens: StoredTokens = {
              refreshToken: parsed.refreshToken,
              sessionId: parsed.sessionId,
            };
            this.inMemory = tokens;
            return { ...this.inMemory };
          }
        }
      }
    } catch {
      // Ignore file storage read errors
    }

    return null;
  }

  async write(tokens: StoredTokens): Promise<void> {
    this.inMemory = { ...tokens };
    const serialized = JSON.stringify(tokens);

    // 1. Try localStorage
    try {
      const scope = getGlobalScope();
      if (scope.localStorage) {
        scope.localStorage.setItem(this.storageKey, serialized);
      }
    } catch {
      // Ignore localStorage write errors
    }

    // 2. Try Node/Windows async file storage
    try {
      const storagePath = getStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs) {
        await asyncWriteFile(fs, storagePath, serialized);
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
      const storagePath = getStoragePath();
      const fs = getNodeFs();
      if (storagePath && fs) {
        await asyncUnlink(fs, storagePath);
      }
    } catch {
      // Ignore file storage unlink errors
    }
  }
}
