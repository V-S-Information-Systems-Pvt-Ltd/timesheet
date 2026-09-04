export const MAX_RECENT_WORK_ENTRIES = 10;

/**
 * In-memory / local storage for recent work description suggestions,
 * strictly isolated by server origin and actor ID.
 */
export class RecentWorkStore {
  private store = new Map<string, string[]>();

  private makeKey(serverOrigin: string, actorId: string): string {
    const origin = serverOrigin.trim().toLowerCase().replace(/\/+$/, '');
    return `${origin}::${actorId}::recent_work`;
  }

  get(serverOrigin?: string | null, actorId?: string | null): string[] {
    if (!serverOrigin || !actorId) return [];
    const key = this.makeKey(serverOrigin, actorId);
    return [...(this.store.get(key) ?? [])];
  }

  add(serverOrigin?: string | null, actorId?: string | null, description?: string): void {
    if (!serverOrigin || !actorId || !description) return;
    const clean = description.trim();
    if (!clean) return;

    const key = this.makeKey(serverOrigin, actorId);
    const existing = this.store.get(key) ?? [];
    const updated = [clean, ...existing.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(
      0,
      MAX_RECENT_WORK_ENTRIES
    );
    this.store.set(key, updated);
  }

  clear(serverOrigin?: string | null, actorId?: string | null): void {
    if (serverOrigin && actorId) {
      this.store.delete(this.makeKey(serverOrigin, actorId));
    } else {
      this.store.clear();
    }
  }
}

export const recentWorkStore = new RecentWorkStore();
