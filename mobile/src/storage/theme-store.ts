import {
  defaultKvStore,
  type AsyncKeyValueStore,
} from '../platform/kv-store';

export type ThemePreference = 'system' | 'light' | 'dark';

export class ThemeStore {
  private inMemory: ThemePreference = 'system';
  private readonly storageKey = 'vsis_timesheet_theme_preference';

  constructor(private readonly store: AsyncKeyValueStore = defaultKvStore) {}

  getInitialSync(): ThemePreference {
    return this.inMemory;
  }

  async get(): Promise<ThemePreference> {
    try {
      const raw = await this.store.getItem(this.storageKey);
      if (raw === 'system' || raw === 'light' || raw === 'dark') {
        this.inMemory = raw;
        return raw;
      }
    } catch {
      // Theme may fall back to default/in-memory on storage failure
    }
    return this.inMemory;
  }

  async set(preference: ThemePreference): Promise<void> {
    if (preference !== 'system' && preference !== 'light' && preference !== 'dark') {
      return;
    }
    this.inMemory = preference;
    try {
      await this.store.setItem(this.storageKey, preference);
    } catch {
      // Theme may fall back to in-memory on storage failure
    }
  }

  async clear(): Promise<void> {
    this.inMemory = 'system';
    try {
      await this.store.removeItem(this.storageKey);
    } catch {
      // Theme may fall back to in-memory on storage failure
    }
  }
}

export const themeStore = new ThemeStore();
