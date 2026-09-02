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

export class SessionController {
  private state: SessionState = { status: 'signed-out' };
  private refreshPromise: Promise<string> | null = null;

  constructor(private readonly client: SessionApi, private readonly store: SecureTokenStore) {}

  getState(): SessionState {
    return this.state;
  }

  async restore(): Promise<SessionState> {
    this.state = { status: 'loading' };
    let stored: StoredTokens | null;
    try {
      stored = await this.store.read();
    } catch (error) {
      this.state = { status: 'error', message: storageFailureMessage(error, 'read') };
      return this.state;
    }
    if (!stored) {
      this.state = { status: 'signed-out' };
      return this.state;
    }
    try {
      const pair = await this.client.refresh(stored.refreshToken);
      await this.applyPair(pair, stored.sessionId);
      return this.state;
    } catch (error) {
      // If server rejected the refresh token as invalid/revoked/expired, clear local secrets
      const isAuthRejection =
        error instanceof ApiClientError &&
        (error.status === 400 || error.status === 401 || error.status === 403);

      if (isAuthRejection) {
        try {
          await this.store.clear();
          this.state = { status: 'signed-out' };
        } catch (clearError) {
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
    this.state = { status: 'loading' };
    let result: (MobileTokenPair & { actor: MobileActor }) | null = null;
    try {
      result = await this.client.login(input);
      try {
        await this.store.write({ refreshToken: result.refreshToken, sessionId: result.sessionId });
      } catch (storeError) {
        // Local credential persistence failed: roll back newly created server session
        try {
          await this.client.logout(result.accessToken);
        } catch {
          // Best effort rollback
        }
        if (storeError instanceof SecureStorageError) throw storeError;
        throw new SecureStorageError('write-failed', 'Secure credential persistence failed.');
      }

      this.state = result.actor.isActive
        ? { status: 'signed-in', actor: result.actor, accessToken: result.accessToken, tokens: { refreshToken: result.refreshToken, sessionId: result.sessionId } }
        : { status: 'pending-approval', actor: result.actor, accessToken: result.accessToken, tokens: { refreshToken: result.refreshToken, sessionId: result.sessionId } };
      return this.state;
    } catch (error) {
      this.state = {
        status: 'error',
        message: error instanceof SecureStorageError ? storageFailureMessage(error, 'write') : 'Sign-in failed.',
      };
      return this.state;
    }
  }

  async checkStatus(): Promise<SessionState> {
    if (this.state.status === 'pending-approval' || this.state.status === 'signed-in') {
      const actor = await this.client.getMe(this.state.accessToken);
      this.state = actor.isActive
        ? { status: 'signed-in', actor, accessToken: this.state.accessToken, tokens: this.state.tokens }
        : { status: 'pending-approval', actor, accessToken: this.state.accessToken, tokens: this.state.tokens };
      return this.state;
    }
    return this.restore();
  }

  async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh()
      .catch((error) => {
        if (error instanceof SecureStorageError) {
          this.state = { status: 'error', message: storageFailureMessage(error, 'write') };
        }
        throw error;
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  async signOut(): Promise<void> {
    if (this.state.status === 'signed-in' || this.state.status === 'pending-approval') {
      try {
        await this.client.logout(this.state.accessToken);
      } catch {
        // Local logout must complete even if the server is unreachable.
      }
    }
    try {
      await this.store.clear();
      this.state = { status: 'signed-out' };
    } catch (error) {
      this.state = { status: 'error', message: storageFailureMessage(error, 'cleanup') };
    }
  }

  async logoutAll(): Promise<void> {
    if (this.state.status === 'signed-in' || this.state.status === 'pending-approval') {
      try {
        await this.client.logoutAll(this.state.accessToken);
      } catch {
        // Local logout must complete even if the server is unreachable.
      }
    }
    try {
      await this.store.clear();
      this.state = { status: 'signed-out' };
    } catch (error) {
      this.state = { status: 'error', message: storageFailureMessage(error, 'cleanup') };
    }
  }

  private async performRefresh(): Promise<string> {
    let stored: StoredTokens | null;
    try {
      stored = await this.store.read();
    } catch (error) {
      if (error instanceof SecureStorageError) throw error;
      throw new SecureStorageError('read-failed', 'Secure credential read failed.');
    }
    if (!stored) throw new Error('No mobile session is available.');
    const pair = await this.client.refresh(stored.refreshToken);
    await this.applyPair(pair, stored.sessionId);
    return pair.accessToken;
  }

  private async applyPair(pair: MobileTokenPair, previousSessionId: string): Promise<void> {
    const tokens = { refreshToken: pair.refreshToken, sessionId: pair.sessionId || previousSessionId };
    try {
      await this.store.write(tokens);
    } catch (error) {
      try {
        await this.store.clear();
      } catch {
        // Preserve the original storage failure; the caller still enters error state.
      }
      if (error instanceof SecureStorageError) throw error;
      throw new SecureStorageError('write-failed', 'Secure credential persistence failed.');
    }
    const actor = await this.client.getMe(pair.accessToken);
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
