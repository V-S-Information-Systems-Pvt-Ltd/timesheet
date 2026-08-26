import type { MobileDashboardData } from '../api/contracts';

/**
 * Pluggable persistence for non-sensitive cached payloads. Tokens must never
 * be written through this interface — only dashboard/list data.
 */
export interface CachePersistence {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Default in-memory persistence; survives only within the app process. */
export class MemoryCachePersistence implements CachePersistence {
  private values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

const KEY = 'dashboard-cache-v1';

/**
 * Caches the last successful dashboard payload so the home screen can render
 * read-only data while offline.
 */
export class DashboardCache {
  private readonly persistence: CachePersistence;

  constructor(persistence: CachePersistence = new MemoryCachePersistence()) {
    this.persistence = persistence;
  }

  async load(): Promise<MobileDashboardData | null> {
    try {
      const raw = await this.persistence.get(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as MobileDashboardData;
      if (!parsed || !parsed.actor || !parsed.today || !Array.isArray(parsed.recentEntries)) return null;
      return parsed;
    } catch {
      await this.persistence.remove(KEY).catch(() => undefined);
      return null;
    }
  }

  async save(data: MobileDashboardData): Promise<void> {
    await this.persistence.set(KEY, JSON.stringify(data));
  }

  async clear(): Promise<void> {
    await this.persistence.remove(KEY);
  }
}
