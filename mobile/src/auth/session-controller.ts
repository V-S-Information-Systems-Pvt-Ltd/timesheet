import { ApiClientError } from '../api/client';
import type { MobileActor, MobileLoginInput, MobileTokenPair } from '../api/contracts';
import type { SecureTokenStore, StoredTokens } from './token-store';
import { SecureStorageError } from '../platform/secure-storage/types';

export interface SessionApi {
  login(input: MobileLoginInput): Promise<MobileTokenPair & { actor: MobileActor }>;
  refresh(refreshToken: string): Promise<MobileTokenPair>;
  getMe(accessToken: string): Promise<MobileActor>;
  logout(accessToken: string): Promise<void>;
  logoutAll(accessToken: string): Promise<void>;
}

export type SessionState =
  | { status: 'signed-out' }
  | { status: 'loading' }
  | { status: 'signed-in'; actor: MobileActor; accessToken: string; tokens: StoredTokens }
  | { status: 'pending-approval'; actor: MobileActor; accessToken: string; tokens: StoredTokens }
  | { status: 'offline'; tokens: StoredTokens }
  | { status: 'error'; message: string };

export class SessionCancelledError extends Error {
  constructor() { super('Session operation was superseded.'); this.name = 'SessionCancelledError'; }
}

export class SessionLifecycle {
  private generation = 0;
  private storageTail: Promise<unknown> = Promise.resolve();
  private acceptedTokens = new Set<string>();
  private latestToken: string | null = null;
  constructor(readonly tokenStore?: SecureTokenStore) {}

  current(): number { return this.generation; }
  advance(): number {
    this.acceptedTokens.clear();
    this.latestToken = null;
    return ++this.generation;
  }
  acceptToken(generation: number, token: string): void {
    this.assertCurrent(generation);
    this.acceptedTokens.add(token);
    this.latestToken = token;
  }
  tokenForRefresh(failedToken?: string): string {
    if (!this.latestToken || (failedToken !== undefined && !this.acceptedTokens.has(failedToken))) {
      throw new SessionCancelledError();
    }
    return this.latestToken;
  }
  assertCurrent(generation: number): void {
    if (generation !== this.generation) throw new SessionCancelledError();
  }
  storage<T>(generation: number, operation: () => Promise<T>): Promise<T> {
    const request = this.storageTail.then(async () => {
      this.assertCurrent(generation);
      const result = await operation();
      this.assertCurrent(generation);
      return result;
    });
    this.storageTail = request.catch(() => undefined);
    return request;
  }
}

export class SessionController {
  private state: SessionState = { status: 'signed-out' };
  private refreshPromise: { generation: number; promise: Promise<string> } | null = null;

  constructor(private readonly client: SessionApi, private readonly store: SecureTokenStore,
    readonly lifecycle = new SessionLifecycle()) {}

  getState(): SessionState {
    return this.state;
  }

  async restore(): Promise<SessionState> {
    const generation = this.lifecycle.advance();
    this.state = { status: 'loading' };
    let stored: StoredTokens | null;
    try {
      stored = await this.lifecycle.storage(generation, () => this.store.read());
    } catch (error) {
      this.lifecycle.assertCurrent(generation);
      this.state = { status: 'error', message: storageFailureMessage(error, 'read') };
      return this.state;
    }
    if (!stored) {
      this.state = { status: 'signed-out' };
      return this.state;
    }
    try {
      const pair = await this.client.refresh(stored.refreshToken);
      this.lifecycle.assertCurrent(generation);
      await this.applyPair(pair, stored.sessionId, generation);
      return this.state;
    } catch (error) {
      this.lifecycle.assertCurrent(generation);
      // If server rejected the refresh token as invalid/revoked/expired, clear local secrets
      const isAuthRejection =
        error instanceof ApiClientError &&
        (error.status === 400 || error.status === 401 || error.status === 403);

      if (isAuthRejection) {
        try {
          await this.lifecycle.storage(generation, () => this.store.clear());
          this.state = { status: 'signed-out' };
        } catch (clearError) {
          this.lifecycle.assertCurrent(generation);
          this.state = { status: 'error', message: storageFailureMessage(clearError, 'cleanup') };
        }
      } else if (error instanceof SecureStorageError) {
        this.state = { status: 'error', message: storageFailureMessage(error, 'write') };
      } else {
        // Network/server outage: preserve stored refresh token for retry
        this.state = { status: 'offline', tokens: stored };
      }
      return this.state;
    }
  }

  async signIn(input: MobileLoginInput): Promise<SessionState> {
    const generation = this.lifecycle.advance();
    this.state = { status: 'loading' };
    let result: (MobileTokenPair & { actor: MobileActor }) | null = null;
    try {
      result = await this.client.login(input);
      try {
        this.lifecycle.assertCurrent(generation);
        const tokens = { refreshToken: result.refreshToken, sessionId: result.sessionId };
        await this.lifecycle.storage(generation, () => this.store.write(tokens));
      } catch (storeError) {
        // Local credential persistence failed: roll back newly created server session
        try {
          await this.client.logout(result.accessToken);
        } catch {
          // Best effort rollback
        }
        this.lifecycle.assertCurrent(generation);
        if (storeError instanceof SecureStorageError) throw storeError;
        throw new SecureStorageError('write-failed', 'Secure credential persistence failed.');
      }

      this.state = result.actor.isActive
        ? { status: 'signed-in', actor: result.actor, accessToken: result.accessToken, tokens: { refreshToken: result.refreshToken, sessionId: result.sessionId } }
        : { status: 'pending-approval', actor: result.actor, accessToken: result.accessToken, tokens: { refreshToken: result.refreshToken, sessionId: result.sessionId } };
      this.lifecycle.acceptToken(generation, result.accessToken);
      return this.state;
    } catch (error) {
      this.lifecycle.assertCurrent(generation);
      this.state = {
        status: 'error',
        message: error instanceof SecureStorageError ? storageFailureMessage(error, 'write') : 'Sign-in failed.',
      };
      return this.state;
    }
  }

  async checkStatus(): Promise<SessionState> {
    const snapshot = this.state;
    const generation = this.lifecycle.current();
    if (snapshot.status === 'pending-approval' || snapshot.status === 'signed-in') {
      let actor: MobileActor;
      try { actor = await this.client.getMe(snapshot.accessToken); }
      catch (error) { this.lifecycle.assertCurrent(generation); throw error; }
      this.lifecycle.assertCurrent(generation);
      const current = this.state;
      if (current.status !== 'signed-in' && current.status !== 'pending-approval') return current;
      this.state = actor.isActive
        ? { status: 'signed-in', actor, accessToken: current.accessToken, tokens: current.tokens }
        : { status: 'pending-approval', actor, accessToken: current.accessToken, tokens: current.tokens };
      return this.state;
    }
    return this.restore();
  }

  async refreshAccessToken(): Promise<string> {
    const generation = this.lifecycle.current();
    if (this.refreshPromise?.generation === generation) return this.refreshPromise.promise;
    const promise = this.performRefresh(generation)
      .catch((error) => {
        this.lifecycle.assertCurrent(generation);
        if (error instanceof SecureStorageError) {
          this.state = { status: 'error', message: storageFailureMessage(error, 'write') };
        }
        throw error;
      })
      .finally(() => {
        if (this.refreshPromise?.promise === promise) this.refreshPromise = null;
      });
    this.refreshPromise = { generation, promise };
    return promise;
  }

  async refreshForRequest(failedToken: string | undefined, generation: number): Promise<string> {
    this.lifecycle.assertCurrent(generation);
    const latest = this.lifecycle.tokenForRefresh(failedToken);
    if (failedToken !== undefined && failedToken !== latest) return latest;
    const token = await this.refreshAccessToken();
    this.lifecycle.assertCurrent(generation);
    return token;
  }

  async signOut(): Promise<void> {
    const generation = this.lifecycle.advance();
    if (this.state.status === 'signed-in' || this.state.status === 'pending-approval') {
      this.client.logout(this.state.accessToken).catch(() => undefined);
    }
    try {
      await this.lifecycle.storage(generation, () => this.store.clear());
      this.state = { status: 'signed-out' };
    } catch (error) {
      this.lifecycle.assertCurrent(generation);
      this.state = { status: 'error', message: storageFailureMessage(error, 'cleanup') };
    }
  }

  async logoutAll(): Promise<void> {
    const generation = this.lifecycle.advance();
    if (this.state.status === 'signed-in' || this.state.status === 'pending-approval') {
      this.client.logoutAll(this.state.accessToken).catch(() => undefined);
    }
    try {
      await this.lifecycle.storage(generation, () => this.store.clear());
      this.state = { status: 'signed-out' };
    } catch (error) {
      this.lifecycle.assertCurrent(generation);
      this.state = { status: 'error', message: storageFailureMessage(error, 'cleanup') };
    }
  }

  private async performRefresh(generation: number): Promise<string> {
    let stored: StoredTokens | null;
    try {
      stored = await this.lifecycle.storage(generation, () => this.store.read());
    } catch (error) {
      this.lifecycle.assertCurrent(generation);
      if (error instanceof SecureStorageError) throw error;
      throw new SecureStorageError('read-failed', 'Secure credential read failed.');
    }
    if (!stored) throw new Error('No mobile session is available.');
    const pair = await this.client.refresh(stored.refreshToken);
    this.lifecycle.assertCurrent(generation);
    await this.applyPair(pair, stored.sessionId, generation);
    return pair.accessToken;
  }

  private async applyPair(pair: MobileTokenPair, previousSessionId: string, generation: number): Promise<void> {
    const tokens = { refreshToken: pair.refreshToken, sessionId: pair.sessionId || previousSessionId };
    try {
      await this.lifecycle.storage(generation, () => this.store.write(tokens));
    } catch (error) {
      this.lifecycle.assertCurrent(generation);
      try {
        await this.lifecycle.storage(generation, () => this.store.clear());
      } catch {
        // Preserve the original storage failure; the caller still enters error state.
      }
      this.lifecycle.assertCurrent(generation);
      if (error instanceof SecureStorageError) throw error;
      throw new SecureStorageError('write-failed', 'Secure credential persistence failed.');
    }
    this.lifecycle.acceptToken(generation, pair.accessToken);
    const actor = await this.client.getMe(pair.accessToken);
    this.lifecycle.assertCurrent(generation);
    this.state = actor.isActive
      ? { status: 'signed-in', actor, accessToken: pair.accessToken, tokens }
      : { status: 'pending-approval', actor, accessToken: pair.accessToken, tokens };
  }
}

function storageFailureMessage(error: unknown, operation: 'read' | 'write' | 'cleanup'): string {
  if (error instanceof SecureStorageError) {
    switch (error.code) {
      case 'locked':
        return 'Secure storage is locked. Unlock the device and try again.';
      case 'corrupt':
        return 'Stored credentials are invalid. Please sign in again.';
      case 'unavailable':
        return 'Secure storage is unavailable on this build.';
      default:
        return operation === 'cleanup'
          ? 'Secure credential cleanup failed.'
          : operation === 'read'
            ? 'Secure credential read failed.'
            : 'Secure credential persistence failed.';
    }
  }
  return operation === 'cleanup'
    ? 'Secure credential cleanup failed.'
    : operation === 'read'
      ? 'Secure credential read failed.'
      : 'Secure credential persistence failed.';
}
