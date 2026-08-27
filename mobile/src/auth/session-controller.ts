import { ApiClientError } from '../api/client';
import type { MobileActor, MobileLoginInput, MobileTokenPair } from '../api/contracts';
import type { SecureTokenStore, StoredTokens } from './token-store';

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
    const stored = await this.store.read();
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
        await this.store.clear();
        this.state = { status: 'signed-out' };
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
        throw new Error(
          `Secure storage write failed: ${storeError instanceof Error ? storeError.message : 'Unable to persist credentials'}`
        );
      }

      this.state = result.actor.isActive
        ? { status: 'signed-in', actor: result.actor, accessToken: result.accessToken, tokens: { refreshToken: result.refreshToken, sessionId: result.sessionId } }
        : { status: 'pending-approval', actor: result.actor, accessToken: result.accessToken, tokens: { refreshToken: result.refreshToken, sessionId: result.sessionId } };
      return this.state;
    } catch (error) {
      this.state = { status: 'error', message: error instanceof Error ? error.message : 'Sign-in failed.' };
      return this.state;
    }
  }

  async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
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
    await this.store.clear();
    this.state = { status: 'signed-out' };
  }

  async logoutAll(): Promise<void> {
    if (this.state.status === 'signed-in' || this.state.status === 'pending-approval') {
      try {
        await this.client.logoutAll(this.state.accessToken);
      } catch {
        // Local logout must complete even if the server is unreachable.
      }
    }
    await this.store.clear();
    this.state = { status: 'signed-out' };
  }

  private async performRefresh(): Promise<string> {
    const stored = await this.store.read();
    if (!stored) throw new Error('No mobile session is available.');
    const pair = await this.client.refresh(stored.refreshToken);
    await this.applyPair(pair, stored.sessionId);
    return pair.accessToken;
  }

  private async applyPair(pair: MobileTokenPair, previousSessionId: string): Promise<void> {
    const tokens = { refreshToken: pair.refreshToken, sessionId: pair.sessionId || previousSessionId };
    await this.store.write(tokens);
    const actor = await this.client.getMe(pair.accessToken);
    this.state = actor.isActive
      ? { status: 'signed-in', actor, accessToken: pair.accessToken, tokens }
      : { status: 'pending-approval', actor, accessToken: pair.accessToken, tokens };
  }
}
