// Recent data and pending reads belong to one SessionProvider session. Never
// retain credentials here; the provider invalidates this cache on session changes.
export const SESSION_READ_TTL_MS = 30_000;

export class SessionReadCache<T> {
  private revision = 0;
  private cached: { data: T; fetchedAt: number } | null = null;
  private pending: Promise<T | null> | null = null;

  invalidate(): void {
    this.revision += 1;
    this.cached = null;
    this.pending = null;
  }

  read(fetchData: () => Promise<T>, applyData: (data: T) => void, force = false): Promise<T | null> {
    if (force) this.invalidate();
    if (this.pending) return this.pending;
    if (this.cached && Date.now() - this.cached.fetchedAt < SESSION_READ_TTL_MS) {
      return Promise.resolve(this.cached.data);
    }

    const revision = this.revision;
    const request = Promise.resolve().then(fetchData).then(
      (data) => {
        if (this.revision !== revision) return null;
        this.cached = { data, fetchedAt: Date.now() };
        applyData(data);
        return data;
      },
      (error: unknown) => {
        if (this.revision !== revision) return null;
        throw error;
      }
    ).finally(() => {
      if (this.pending === request) this.pending = null;
    });
    this.pending = request;
    return request;
  }
}
