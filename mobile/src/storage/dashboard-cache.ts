import type { MobileDashboardData } from '../api/contracts';

/**
 * In-memory / local read-only cache for the dashboard payload.
 * Security rule: Never cache tokens or passwords here.
 */
class DashboardCache {
  private cachedData: MobileDashboardData | null = null;
  private lastFetchedAt: number | null = null;

  get(): MobileDashboardData | null {
    return this.cachedData ? { ...this.cachedData } : null;
  }

  set(data: MobileDashboardData): void {
    this.cachedData = { ...data };
    this.lastFetchedAt = Date.now();
  }

  getLastFetchedAt(): number | null {
    return this.lastFetchedAt;
  }

  clear(): void {
    this.cachedData = null;
    this.lastFetchedAt = null;
  }
}

export const dashboardCache = new DashboardCache();
