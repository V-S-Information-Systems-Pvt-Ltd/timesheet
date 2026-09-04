import type { MobileDashboardData } from '../api/contracts';

export const DASHBOARD_CACHE_VERSION = 1;
export const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface CachedDashboardEntry {
  data: MobileDashboardData;
  fetchedAt: number;
  version: number;
}

/**
 * In-memory / local read-only cache for the dashboard payload, strictly
 * isolated by server origin, actor ID, and version.
 * Security rule: Never cache tokens or passwords here.
 */
export class DashboardCache {
  private cache = new Map<string, CachedDashboardEntry>();

  private makeKey(serverOrigin: string, actorId: string): string {
    const origin = serverOrigin.trim().toLowerCase().replace(/\/+$/, '');
    return `${origin}::${actorId}::v${DASHBOARD_CACHE_VERSION}`;
  }

  get(serverOrigin?: string, actorId?: string, maxAgeMs = DASHBOARD_CACHE_TTL_MS): MobileDashboardData | null {
    if (!serverOrigin || !actorId) return null;
    const key = this.makeKey(serverOrigin, actorId);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > maxAgeMs) {
      this.cache.delete(key);
      return null;
    }
    return { ...entry.data };
  }

  set(serverOrigin: string, actorId: string, data: MobileDashboardData): void {
    if (!serverOrigin || !actorId || !data) return;
    const key = this.makeKey(serverOrigin, actorId);
    this.cache.set(key, {
      data: { ...data },
      fetchedAt: Date.now(),
      version: DASHBOARD_CACHE_VERSION,
    });
  }

  getLastFetchedAt(serverOrigin?: string, actorId?: string): number | null {
    if (!serverOrigin || !actorId) return null;
    const key = this.makeKey(serverOrigin, actorId);
    return this.cache.get(key)?.fetchedAt ?? null;
  }

  clear(serverOrigin?: string, actorId?: string): void {
    if (serverOrigin && actorId) {
      this.cache.delete(this.makeKey(serverOrigin, actorId));
    } else {
      this.cache.clear();
    }
  }
}

export const dashboardCache = new DashboardCache();
