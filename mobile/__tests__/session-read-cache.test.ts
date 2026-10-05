import { SessionReadCache, SESSION_READ_TTL_MS } from '../src/auth/session-read-cache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('session read freshness and concurrency', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shares simultaneous reads and reuses a result only until the freshness window expires', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const cache = new SessionReadCache<string>();
    const response = deferred<string>();
    const fetchData = jest.fn().mockReturnValueOnce(response.promise).mockResolvedValue('new');
    const applyData = jest.fn();
    const first = cache.read(fetchData, applyData);
    const second = cache.read(fetchData, applyData);
    response.resolve('old');
    expect(await first).toBe('old');
    expect(await second).toBe('old');
    expect(await cache.read(fetchData, applyData)).toBe('old');
    expect(fetchData).toHaveBeenCalledTimes(1);
    now += SESSION_READ_TTL_MS;
    expect(await cache.read(fetchData, applyData)).toBe('new');
    expect(fetchData).toHaveBeenCalledTimes(2);
  });

  it('a forced refresh supersedes a pending read and the older response cannot overwrite it', async () => {
    const cache = new SessionReadCache<string>();
    const old = deferred<string>();
    const fresh = deferred<string>();
    const applyData = jest.fn();
    const first = cache.read(() => old.promise, applyData);
    const refresh = cache.read(() => fresh.promise, applyData, true);
    fresh.resolve('fresh');
    expect(await refresh).toBe('fresh');
    old.resolve('old');
    expect(await first).toBeNull();
    expect(applyData.mock.calls).toEqual([['fresh']]);
    const fetchData = jest.fn();
    expect(await cache.read(fetchData, applyData)).toBe('fresh');
    expect(fetchData).not.toHaveBeenCalled();
  });

  it('allows retry after failure and suppresses failures from an invalidated session', async () => {
    const cache = new SessionReadCache<string>();
    const applyData = jest.fn();
    await expect(cache.read(() => Promise.reject(new Error('offline')), applyData)).rejects.toThrow('offline');
    expect(await cache.read(() => Promise.resolve('recovered'), applyData)).toBe('recovered');
    const late = deferred<string>();
    const pending = cache.read(() => late.promise, applyData, true);
    cache.invalidate();
    late.reject(new Error('old session expired'));
    expect(await pending).toBeNull();
    expect(applyData.mock.calls).toEqual([['recovered']]);
  });

  it('drops cached and pending data on session invalidation', async () => {
    const cache = new SessionReadCache<string>();
    const applyData = jest.fn();
    await cache.read(() => Promise.resolve('account-a'), applyData);
    const response = deferred<string>();
    const pending = cache.read(() => response.promise, applyData, true);
    cache.invalidate();
    response.resolve('account-a-late');
    expect(await pending).toBeNull();
    expect(await cache.read(() => Promise.resolve('account-b'), applyData)).toBe('account-b');
    expect(applyData.mock.calls).toEqual([['account-a'], ['account-b']]);
  });
});
